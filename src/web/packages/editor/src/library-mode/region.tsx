import { Tabs } from "@base-ui/react/tabs";
import type { CatalogueOrigin } from "@yunari/renderer-core";
import type * as React from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { BareSegmented } from "../components/ui/bare-segmented.js";
import {
  createGridDensityPreference,
  DEFAULT_GRID_DENSITY,
  type GridDensityLevel,
} from "../editor-shell/grid-density.js";
import { Glyph } from "../editor-shell/icons.js";
import { readCollectionPlan } from "../store-mode/collection-plan.js";
import { Gallery } from "../store-mode/gallery.js";
import { withInstalledVersions } from "../store-mode/install-state.js";
import { actionLabel } from "../store-mode/item-foot.js";
import { ItemModal } from "../store-mode/item-modal.js";
import {
  type CellAction,
  type ItemSource,
  type StoreItem,
  settledTags,
} from "../store-mode/local-source.js";
import { Empty, Failure, StoreRegion } from "../store-mode/region.js";
import { useInstall } from "../store-mode/use-install.js";
import type { SubmitControl } from "../store-mode/use-submit.js";
import {
  createThemeLibraryClient,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import { collectionStateOf, type StoreCard } from "./cards.js";
import { SubmissionsPage } from "./collection-builder.js";
import { LIBRARY_GROUPS, LIBRARY_PAGES } from "./nav.js";
import { readOrigins } from "./origins.js";
import {
  type CollectionsRead,
  catalogueSourceFor,
  type EditorThemeRow,
  type ExtensionRow,
  type LibraryClients,
  type LibraryPage,
  librarySourceFor,
  type OriginsRead,
  type WidgetPackRow,
} from "./sources.js";

/**
 * The Library's state filter: the one choice over which side of the catalogue a
 * page draws.
 *
 * **A store row is on this PC when it carries an origin**, and a library row is
 * installed by construction. The two are the only facts the filter reads (see
 * `rowsFor` below), so a page cannot disagree with the register about what is
 * installed.
 */
export type LibraryState = "all" | "on-this-pc" | "not-installed";

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

/** The pages whose cards can be code, so their detail's trust block reads the
 *  installed extension listing. A page not named here draws no code kind. */
const CODE_PAGES: ReadonlySet<LibraryPage> = new Set([
  "sensor-providers",
  "asset-sources",
  "panel-drivers",
]);

/** The Sensor providers page's two member kinds, in its sub-filter's order. */
const SENSOR_KINDS = ["sensor-provider", "data-source"] as const;

type SensorKind = (typeof SENSOR_KINDS)[number];

const SENSOR_NAMES: Record<SensorKind, string> = {
  "sensor-provider": uiCopy.library.sensors.sensors,
  "data-source": uiCopy.library.sensors.dataSources,
};

/** One row, tagged with the half it was read from. The tag is what keeps a
 *  library row in "On this PC" whatever its origin says. */
interface Row {
  readonly item: StoreItem;
  readonly half: "store" | "library";
}

/**
 * The two halves joined, then filtered by the state.
 *
 * **A library row that names a catalogue item is that item's installed copy**,
 * so the library half drops it when the catalogue listing actually carries that
 * item; the catalogue row takes the origin the library row carried. A library
 * row whose catalogue id the listing does not carry — an unpublished entry, a
 * page that stopped browsing that kind, or a catalogue half that failed — stays
 * its own row, or the installed copy would vanish with nothing left to remove.
 *
 * The rule is one function because the filter and the grid must not disagree
 * about which rows the state admits.
 *
 * **A collection's installed state is its includes'**, so the filter reads
 * `collectionStateOf` rather than the row's own origin, which a collection
 * never has. A partially installed collection is *On this PC*: it has copies
 * on this PC and reads its count with Update. Only a collection with no
 * include installed is *Not installed*.
 */
function rowsFor(
  catalogue: readonly StoreItem[],
  library: readonly StoreItem[],
  state: LibraryState,
  origins: readonly CatalogueOrigin[] | undefined,
): readonly Row[] {
  const byCatalogueId = new Map<string, CatalogueOrigin>();
  for (const item of library) {
    if (item.origin !== undefined) {
      byCatalogueId.set(item.origin.catalogueId, item.origin);
    }
  }
  const store = withInstalledVersions(catalogue, library).map((item) => {
    const origin = byCatalogueId.get(item.id);
    return origin === undefined ? item : { ...item, origin };
  });
  const listed = new Set(store.map((item) => item.id));
  const libraryOnly = library.filter(
    (item) => item.origin === undefined || !listed.has(item.origin.catalogueId),
  );
  const rows: readonly Row[] = [
    ...store.map((item): Row => ({ item, half: "store" })),
    ...libraryOnly.map((item): Row => ({ item, half: "library" })),
  ];

  if (state === "all") return rows;

  const collectionOf = (row: Row) =>
    origins === undefined ? undefined : collectionStateOf(row.item, origins);

  if (state === "on-this-pc") {
    return rows.filter((row) => {
      if (row.half === "library" || row.item.origin !== undefined) return true;
      const collection = collectionOf(row);
      return collection !== undefined && collection.state !== "absent";
    });
  }
  return rows.filter((row) => {
    const collection = collectionOf(row);
    if (collection !== undefined) return collection.state === "absent";
    return row.half === "store" && row.item.origin === undefined;
  });
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
    async pathPresets() {
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
 * **Dashboard themes keeps today's store grid** for this task: that page still
 * mounts `StoreRegion`, whose own halves are the theme-only surface Tasks 9–13
 * replace. The other pages read Task 7's sources, one catalogue half and one
 * library half, and the state filter decides which rows they draw.
 */
export function LibraryRegion(props: {
  readonly page: LibraryPage;
  readonly onPage: (page: LibraryPage) => void;
  readonly state: LibraryState;
  readonly onState: (state: LibraryState) => void;
  /** The library client, for the theme half the store grid reads. */
  readonly client?: ThemeLibraryClient | undefined;
  readonly onOpenTheme?: ((id: string) => void) | undefined;
  readonly onStatus?: ((count: number | undefined) => void) | undefined;
  /** Opens Settings on Extensions, the trust page a code member's detail links
   *  to. The shell owns the mode and the settings page, so the region passes
   *  the press through rather than moving either. */
  readonly onOpenSettings?: ((page: "extensions") => void) | undefined;
  readonly onThemeDeleted?: ((id: string) => void) | undefined;
  readonly onThemePublished?: ((id: string) => void) | undefined;
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
  const readCollections = useCallback(() => {
    setCollectionsFailed(false);
    collectionsSource.list().then(
      (entries) => setCollectionEntries(entries),
      () => setCollectionsFailed(true),
    );
  }, [collectionsSource]);
  const ensureCollections = useCallback(() => {
    if (collectionsRequested) return;
    setCollectionsRequested(true);
    readCollections();
  }, [collectionsRequested, readCollections]);
  const collections: CollectionsRead = {
    entries: collectionEntries,
    failed: collectionsFailed,
    loading:
      collectionsRequested &&
      collectionEntries === undefined &&
      !collectionsFailed,
    retry: readCollections,
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
            {props.page === "dashboard-themes" ? (
              <StoreRegion
                client={client}
                collections={collections}
                onDetailOpen={ensureDetailReads}
                {...(props.onOpenTheme === undefined
                  ? {}
                  : { onOpenTheme: props.onOpenTheme })}
                {...(props.onStatus === undefined
                  ? {}
                  : { onStatus: props.onStatus })}
                {...(props.onThemeDeleted === undefined
                  ? {}
                  : { onThemeDeleted: props.onThemeDeleted })}
                {...(props.onThemePublished === undefined
                  ? {}
                  : { onThemePublished: props.onThemePublished })}
                {...(props.onOpenSettings === undefined
                  ? {}
                  : { onOpenSettings: props.onOpenSettings })}
              />
            ) : props.page === "submissions" ? (
              <SubmissionsPage />
            ) : (
              <PageListing
                page={props.page}
                state={props.state}
                clients={clients}
                onStatus={props.onStatus}
                collections={collections}
                detailOrigins={detailOrigins}
                onDetailOpen={ensureDetailReads}
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

/** One per-type page: the two halves, the state filter and, on Sensor
 *  providers, the member-kind sub-filter. */
function PageListing(props: {
  readonly page: LibraryPage;
  readonly state: LibraryState;
  readonly clients: LibraryClients;
  readonly onStatus?: ((count: number | undefined) => void) | undefined;
  readonly onOpenSettings?: ((page: "extensions") => void) | undefined;
  readonly collections: CollectionsRead;
  readonly detailOrigins: OriginsRead;
  readonly onDetailOpen: () => void;
}): React.JSX.Element {
  const [density] = useState<GridDensityLevel>(
    () =>
      createGridDensityPreference(browserStorage())?.read() ??
      DEFAULT_GRID_DENSITY,
  );
  const [sensorKind, setSensorKind] = useState<SensorKind>("sensor-provider");
  const sources = useMemo(
    () => ({
      catalogue: catalogueSourceFor(props.page),
      library: librarySourceFor(props.page, props.clients),
    }),
    [props.page, props.clients],
  );
  const [catalogue, setCatalogue] = useState<readonly StoreItem[] | undefined>(
    undefined,
  );
  const [library, setLibrary] = useState<readonly StoreItem[] | undefined>(
    undefined,
  );
  const [catalogueFailed, setCatalogueFailed] = useState(false);
  const [libraryFailed, setLibraryFailed] = useState(false);
  /** The origin register behind each collection's installed count. Read once
   *  per attempt, beside the two listings, because a card never fetches a
   *  member's package to say how many it holds. **Only a page that can draw a
   *  collection asks for it**, so no other page pays for a read it cannot use
   *  or prints a failure for it. */
  const [origins, setOrigins] = useState<
    readonly CatalogueOrigin[] | undefined
  >(undefined);
  const [originsFailed, setOriginsFailed] = useState(false);
  /** The installed extension rows a code member's trust block reads. Read only
   *  on a page that browses code, for the same reason the register is. */
  const [extensions, setExtensions] = useState<
    readonly ExtensionRow[] | undefined
  >(undefined);
  const [extensionsFailed, setExtensionsFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const readsOrigins = sources.catalogue.memberKind === "collection";
  const readsExtensions = CODE_PAGES.has(props.page);
  /** The card whose modal is open. The page owns it because opening a card is a
   *  reading of the listing, not of the cell that drew it. */
  const [openCard, setOpenCard] = useState<StoreCard | undefined>(undefined);
  /** The last cell command this page cannot run yet. Drawn beside the listing
   *  rather than leaving the press silent. */
  const [notice, setNotice] = useState<string | undefined>(undefined);
  /** The pack cards this page has open. The page owns it because opening one is
   *  a reading of the listing, not of the cell that draws it. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setExpanded(new Set());
    setOpenCard(undefined);
    setNotice(undefined);
  }, [props.page]);

  useEffect(() => {
    let live = true;
    setCatalogue(undefined);
    setLibrary(undefined);
    setCatalogueFailed(false);
    setLibraryFailed(false);
    setOrigins(undefined);
    setOriginsFailed(false);
    setExtensions(undefined);
    setExtensionsFailed(false);
    sources.catalogue.list().then(
      (rows) => {
        if (live) setCatalogue(rows);
      },
      () => {
        if (live) setCatalogueFailed(true);
      },
    );
    sources.library.list().then(
      (rows) => {
        if (live) setLibrary(rows);
      },
      () => {
        if (live) setLibraryFailed(true);
      },
    );
    if (readsOrigins) {
      readOrigins().then(
        (rows) => {
          if (live) setOrigins(rows);
        },
        () => {
          if (live) setOriginsFailed(true);
        },
      );
    }
    if (readsExtensions) {
      props.clients.extensions().then(
        (rows) => {
          if (live) setExtensions(rows);
        },
        () => {
          if (live) setExtensionsFailed(true);
        },
      );
    }
    return () => {
      live = false;
    };
  }, [sources, attempt, readsOrigins, readsExtensions, props.clients]);

  const rows = useMemo(
    () => rowsFor(catalogue ?? [], library ?? [], props.state, origins),
    [catalogue, library, props.state, origins],
  );
  const visible =
    props.page === "sensor-providers"
      ? rows.filter((row) =>
          row.item.members.some((member) => member.kind === sensorKind),
        )
      : rows;
  const answered = catalogue !== undefined || library !== undefined;

  // The strip is the shell's; this region owns the count. **A count is
  // published only when both halves answered**: a failed read is not an empty
  // result, so neither "0" nor the surviving half's length stands for it.
  // Nothing is published while a half is pending either.
  const onStatus = props.onStatus;
  const complete =
    catalogue !== undefined &&
    library !== undefined &&
    !catalogueFailed &&
    !libraryFailed;
  const count = complete ? visible.length : undefined;
  useEffect(() => {
    onStatus?.(count);
    return () => onStatus?.(undefined);
  }, [onStatus, count]);

  // **Every page installs through the one hook**, including collections: a
  // collection's press opens the sheet, which posts the chosen ids through
  // `onInstallCollection`. Success re-lists the page and re-reads the register
  // and the extension listing, so a collection's count and a plugin's trust
  // block read what this PC now holds rather than a flag set here.
  const installSource = useMemo<ItemSource>(
    () => ({
      kind: sources.catalogue.memberKind,
      list: () => sources.catalogue.list(),
      refused: () => [],
    }),
    [sources],
  );
  const install = useInstall({
    source: installSource,
    onListed: (listed) => {
      setCatalogue(listed);
      // The installed half is re-read too, so a catalogue install appears under
      // "On this PC" without a page reload.
      sources.library.list().then(
        (rows) => setLibrary(rows),
        () => setLibraryFailed(true),
      );
      if (readsOrigins) {
        readOrigins().then(
          (rows) => setOrigins(rows),
          () => setOriginsFailed(true),
        );
      }
      if (readsExtensions) {
        props.clients.extensions().then(
          (rows) => setExtensions(rows),
          () => setExtensionsFailed(true),
        );
      }
    },
  });
  const submit = useMemo<SubmitControl>(
    () => ({
      onSubmit: () => undefined,
      itemId: undefined,
      state: "idle",
      inFlight: false,
      url: undefined,
      version: undefined,
      refusal: undefined,
      status: undefined,
    }),
    [],
  );
  const onAction = (action: CellAction, card: StoreCard): void => {
    setNotice(
      uiCopy.library.actionPending(
        actionLabel(action, card.member?.kind ?? card.listing.kind),
      ),
    );
  };
  /** Opening or stepping to another card asks for the session's collection
   *  entries, so every page's "Part of" can answer. */
  const openCardAt = (card: StoreCard): void => {
    props.onDetailOpen();
    setOpenCard(card);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {props.page === "sensor-providers" ? (
        <div className="flex flex-none items-center px-[var(--space-16)] pt-[var(--space-12)]">
          <BareSegmented
            id="yunari-library-sensors"
            data={{ "data-yunari-library-sensors": "" }}
            label={uiCopy.library.sensors.label}
            value={sensorKind}
            options={SENSOR_KINDS.map((kind) => ({
              id: kind,
              name: SENSOR_NAMES[kind],
            }))}
            onChange={(kind) => setSensorKind(kind as SensorKind)}
          />
        </div>
      ) : null}

      <div
        data-yunari-library-listing=""
        className="flex min-h-0 flex-1 flex-col gap-[var(--space-8)] p-[var(--space-16)]"
      >
        {catalogueFailed ? (
          <Failure
            message={uiCopy.store.unreadable.online}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : null}
        {libraryFailed ? (
          <Failure
            message={uiCopy.store.unreadable.local}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : null}
        {originsFailed ? (
          <Failure
            message={uiCopy.store.unreadable.origins}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : null}
        {extensionsFailed ? (
          <Failure
            message={uiCopy.store.detail.trust.unreadable}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : null}
        {notice === undefined ? null : (
          <p
            data-yunari-library-action-notice=""
            role="status"
            className="text-xs text-warn"
          >
            {notice}
          </p>
        )}
        {visible.length > 0 ? (
          <Gallery
            items={visible.map((row) => row.item)}
            density={density}
            origins={origins}
            expanded={expanded}
            onExpand={(key) =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onAction={onAction}
            onOpenItem={openCardAt}
            install={install.control}
          />
        ) : answered && !catalogueFailed && !libraryFailed ? (
          <div data-yunari-library-empty="">
            <Empty
              lead={uiCopy.library.empty}
              hint={uiCopy.library.emptyHint}
            />
          </div>
        ) : null}
        {openCard === undefined ? null : (
          <ItemModal
            item={openCard.listing}
            card={openCard}
            {...(openCard.member === undefined
              ? {}
              : { member: openCard.member })}
            collections={props.collections.entries ?? []}
            collectionsLoading={props.collections.loading}
            {...(props.collections.failed
              ? {
                  collectionsFailure: {
                    message: uiCopy.store.detail.partOfFailed,
                    onRetry: props.collections.retry,
                  },
                }
              : {})}
            {...(extensions === undefined ? {} : { extensions })}
            {...(extensionsFailed
              ? {
                  extensionsFailure: {
                    onRetry: () => setAttempt((current) => current + 1),
                  },
                }
              : {})}
            {...(origins === undefined
              ? props.detailOrigins.entries === undefined
                ? {}
                : { origins: props.detailOrigins.entries }
              : { origins })}
            originsLoading={
              origins === undefined && props.detailOrigins.loading
            }
            {...(origins === undefined && props.detailOrigins.failed
              ? {
                  originsFailure: {
                    message: uiCopy.store.unreadable.origins,
                    onRetry: props.detailOrigins.retry,
                  },
                }
              : {})}
            readPlan={readCollectionPlan}
            vocabulary={settledTags(
              [...(catalogue ?? []), ...(library ?? [])],
              openCard.listing,
            )}
            onClose={() => setOpenCard(undefined)}
            onAction={onAction}
            actionNotice={notice}
            install={install.control}
            submit={submit}
            onOpenItem={openCardAt}
            onOpenCollection={openCardAt}
            {...(props.onOpenSettings === undefined
              ? {}
              : { onOpenSettings: props.onOpenSettings })}
          />
        )}
      </div>
      {/* One live region for the page's installs, a collection's consent
          result included: a success is otherwise silent to a screen reader. */}
      <span
        data-yunari-library-install-announcement=""
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {install.announcement}
      </span>
    </div>
  );
}

/** The browser's own storage, or nothing where the accessor itself refuses — a
 *  private window throws on the read. */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
