import { Tabs } from "@base-ui/react/tabs";
import type { CatalogueOrigin } from "@yunari/renderer-core";
import type * as React from "react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { BareSegmented } from "../components/ui/bare-segmented.js";
import { Glyph } from "../editor-shell/icons.js";
import type { StoreItem } from "../store-mode/local-source.js";
import {
  createThemeLibraryClient,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import { SubmissionsPage } from "./collection-builder.js";
import { LIBRARY_GROUPS, LIBRARY_PAGES } from "./nav.js";
import { readOrigins } from "./origins.js";
import { PageListing } from "./page-listing.js";
import {
  type CollectionsRead,
  catalogueSourceFor,
  type EditorThemeRow,
  type ExtensionRow,
  type LibraryClients,
  type LibraryPage,
  type LibraryState,
  type OriginsRead,
  type PathPresetRow,
  type WidgetPackRow,
} from "./sources.js";

/**
 * The Library's state filter: the one choice over which side of the catalogue a
 * page draws.
 *
 * **A store row is on this PC when it carries an origin**, and a library row is
 * installed by construction. The two are the only facts the filter reads (see
 * `rowsFor` in `page-listing.tsx`), so a page cannot disagree with the register
 * about what is installed.
 */
export type { LibraryState } from "./sources.js";

const STATE_ORDER = [
  "all",
  "on-this-pc",
  "not-installed",
] as const satisfies readonly LibraryState[];

/** Each state's name, as a total lookup: a state added to the union without a
 *  word fails to compile here rather than drawing an empty segment. */
const STATE_NAMES: Record<LibraryState, string> = {
  all: uiCopy.library.state.all,
  "on-this-pc": uiCopy.library.state.onThisPc,
  "not-installed": uiCopy.library.state.notInstalled,
};

const STATE_FILTER_ID = "yunari-library-state";

/**
 * The state filter, in the header's **bare** `Segmented` form beside the mode
 * switch: the same well and chosen treatment the halves control used, with this
 * control's own group name. It is a mode-level choice — what every Library page
 * draws — so the shell owns the value (R1).
 */
export function LibraryStateFilter(props: {
  readonly state: LibraryState;
  readonly onState: (state: LibraryState) => void;
}): React.JSX.Element {
  return (
    <BareSegmented
      id={STATE_FILTER_ID}
      data={{ "data-yunari-library-state": "" }}
      label={uiCopy.library.state.label}
      value={props.state}
      options={STATE_ORDER.map((state) => ({
        id: state,
        name: STATE_NAMES[state],
      }))}
      onChange={props.onState}
    />
  );
}

/** A host answer, refused rather than read as an empty listing: "the host
 *  answered garbage" and "nothing is installed" are different facts. */
async function hostJson(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`The host answered ${response.status}.`);
  }
  return response.json();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The host's rows, one reader per listing, as `LibraryClients` asks for them.
 *  The two envelopes the routes wrap their rows in are unwrapped here, and the
 *  extensions are typed at the port so a row's `origin` survives the hook-free
 *  read (`useExtensions` is typed `InstalledExtension`, which has no origin). */
function hostClients(client: ThemeLibraryClient): LibraryClients {
  return {
    themes: () => client.list(),
    async editorThemes(): Promise<readonly EditorThemeRow[]> {
      const body = await hostJson("/api/editor-themes");
      if (!Array.isArray(body)) {
        throw new Error("The host did not answer an editor-theme listing.");
      }
      return body as readonly EditorThemeRow[];
    },
    async widgetPacks(): Promise<readonly WidgetPackRow[]> {
      const body = await hostJson("/api/widget-packs");
      if (!isRecord(body) || !Array.isArray(body["packs"])) {
        throw new Error("The host did not answer a widget-pack listing.");
      }
      return body["packs"] as readonly WidgetPackRow[];
    },
    async pathPresets(): Promise<readonly PathPresetRow[]> {
      const body = await hostJson("/api/path-presets");
      if (!isRecord(body) || !Array.isArray(body["presets"])) {
        throw new Error("The host did not answer a path preset listing.");
      }
      return body["presets"];
    },
    async extensions(): Promise<readonly ExtensionRow[]> {
      const body = await hostJson("/api/extensions");
      if (!isRecord(body) || !Array.isArray(body["extensions"])) {
        throw new Error("The host did not answer an extension listing.");
      }
      return body["extensions"] as readonly ExtensionRow[];
    },
  };
}

/**
 * The Library mode's surface: the navigation column, and the page it chooses.
 *
 * **The page and the state are the shell's** (R1). The region reads them and
 * asks for another, so a later surface can move the mode and the page together
 * through `openLibrary(page)`; it keeps no copy of either.
 *
 * Every page reads Task 7's sources, one catalogue half and one library half,
 * and the state filter decides which rows it draws. Dashboard themes is one of
 * those pages now: the theme-only store grid and its halves are gone, so the
 * page cannot disagree with the others about what "On this PC" means.
 */
export function LibraryRegion(props: {
  readonly page: LibraryPage;
  readonly onPage: (page: LibraryPage) => void;
  readonly state: LibraryState;
  readonly onState: (state: LibraryState) => void;
  /** The library client, for the installed half each page joins against the
   *  catalogue and for the Dashboard themes page's own commands. */
  readonly client?: ThemeLibraryClient | undefined;
  /** Opens a dashboard theme as the editor's document. The shell hands the
   *  session's route; the catalogue page reports the press and the shell moves
   *  the mode only once the session accepts the replacement. */
  readonly onOpenTheme?: ((id: string) => void) | undefined;
  /** Tells the session a stored theme is gone, so the open document's base is
   *  cleared and the next save does not trust the folder the host trashed. */
  readonly onThemeRemoved?: ((id: string) => void) | undefined;
  readonly onStatus?: ((count: number | undefined) => void) | undefined;
  /** Opens Settings on Extensions, the trust page a code member's detail links
   *  to. The shell owns the mode and the settings page, so the region passes
   *  the press through rather than moving either. */
  readonly onOpenSettings?: ((page: "extensions") => void) | undefined;
}): React.JSX.Element {
  const [client] = useState(() => props.client ?? createThemeLibraryClient());
  const clients = useMemo(() => hostClients(client), [client]);
  /** The catalogue's collection entries, for every page's "Part of". Read once
   *  when a detail first opens, never while a grid renders. */
  const collectionsSource = useMemo(
    () => catalogueSourceFor("collections"),
    [],
  );
  const [collectionEntries, setCollectionEntries] = useState<
    readonly StoreItem[] | undefined
  >(undefined);
  const [collectionsFailed, setCollectionsFailed] = useState(false);
  const [collectionsRequested, setCollectionsRequested] = useState(false);
  const collectionsRetry = useCallback(() => {
    setCollectionsFailed(false);
    collectionsSource.list().then(
      (read) => setCollectionEntries(read.rows),
      () => setCollectionsFailed(true),
    );
  }, [collectionsSource]);
  const ensureCollections = useCallback(() => {
    if (collectionsRequested) return;
    setCollectionsRequested(true);
    collectionsRetry();
  }, [collectionsRequested, collectionsRetry]);
  const collections: CollectionsRead = {
    entries: collectionEntries,
    failed: collectionsFailed,
    loading:
      collectionsRequested &&
      collectionEntries === undefined &&
      !collectionsFailed,
    retry: collectionsRetry,
  };
  /** The register behind every collection's install count. Read on the first
   *  detail open on any page, so a collection reached from "Part of" has its
   *  Install or Update press rather than a false "unread" state. */
  const [originEntries, setOriginEntries] = useState<
    readonly CatalogueOrigin[] | undefined
  >(undefined);
  const [originsReadRequested, setOriginsReadRequested] = useState(false);
  const [sessionOriginsFailed, setSessionOriginsFailed] = useState(false);
  const readSessionOrigins = useCallback(() => {
    setSessionOriginsFailed(false);
    readOrigins().then(
      (entries) => setOriginEntries(entries),
      () => setSessionOriginsFailed(true),
    );
  }, []);
  const detailOrigins: OriginsRead = {
    entries: originEntries,
    failed: sessionOriginsFailed,
    loading:
      originsReadRequested &&
      originEntries === undefined &&
      !sessionOriginsFailed,
    retry: readSessionOrigins,
  };
  const ensureDetailReads = useCallback(() => {
    ensureCollections();
    if (originsReadRequested) return;
    setOriginsReadRequested(true);
    readSessionOrigins();
  }, [ensureCollections, originsReadRequested, readSessionOrigins]);

  return (
    <div data-yunari-library-region="" className="flex min-h-0 flex-1 flex-col">
      <Tabs.Root
        value={props.page}
        onValueChange={(value) => props.onPage(value as LibraryPage)}
        orientation="vertical"
        className="library-mode"
      >
        <div className="library-mode-nav" data-yunari-library-nav="">
          <Tabs.List
            aria-label={uiCopy.library.label}
            className="library-mode-nav-list"
          >
            {LIBRARY_GROUPS.map((group) => (
              <Fragment key={group.id}>
                <div
                  className="library-mode-nav-group"
                  data-yunari-library-nav-group=""
                  role="presentation"
                >
                  {group.label}
                </div>
                {LIBRARY_PAGES.filter((page) => page.group === group.id).map(
                  (page) => (
                    <Tabs.Tab
                      key={page.id}
                      value={page.id}
                      data-yunari-library-nav-item={page.id}
                      className="library-mode-nav-item"
                    >
                      <Glyph icon={page.glyph} size={14} />
                      {page.label}
                    </Tabs.Tab>
                  ),
                )}
              </Fragment>
            ))}
          </Tabs.List>
        </div>
        <div className="library-mode-content" data-yunari-library-scroller="">
          <Tabs.Panel
            value={props.page}
            data-yunari-library-panel={props.page}
            className="library-mode-page"
          >
            {props.page === "submissions" ? (
              <SubmissionsPage />
            ) : (
              <PageListing
                page={props.page}
                state={props.state}
                client={client}
                clients={clients}
                onStatus={props.onStatus}
                collections={collections}
                detailOrigins={detailOrigins}
                onDetailOpen={ensureDetailReads}
                {...(props.onOpenTheme === undefined
                  ? {}
                  : { onOpenTheme: props.onOpenTheme })}
                {...(props.onThemeRemoved === undefined
                  ? {}
                  : { onThemeRemoved: props.onThemeRemoved })}
                {...(props.onOpenSettings === undefined
                  ? {}
                  : { onOpenSettings: props.onOpenSettings })}
              />
            )}
          </Tabs.Panel>
        </div>
      </Tabs.Root>
    </div>
  );
}
