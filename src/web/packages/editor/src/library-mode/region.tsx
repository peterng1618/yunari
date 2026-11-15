import { Tabs } from "@base-ui/react/tabs";
import type { CatalogueOrigin } from "@yunari/renderer-core";
import type * as React from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { BareSegmented } from "../components/ui/bare-segmented.js";
import {
  createGridDensityPreference,
  DEFAULT_GRID_DENSITY,
  type GridDensityLevel,
} from "../editor-shell/grid-density.js";
import { Glyph } from "../editor-shell/icons.js";
import { Gallery } from "../store-mode/gallery.js";
import type { InstallControl } from "../store-mode/install-item.js";
import { withInstalledVersions } from "../store-mode/install-state.js";
import type { StoreItem } from "../store-mode/local-source.js";
import { Empty, Failure, StoreRegion } from "../store-mode/region.js";
import {
  createThemeLibraryClient,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import { LIBRARY_GROUPS, LIBRARY_PAGES } from "./nav.js";
import {
  catalogueSourceFor,
  type EditorThemeRow,
  type ExtensionRow,
  type LibraryClients,
  type LibraryPage,
  librarySourceFor,
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
 * so the library half never draws it beside the catalogue row; the catalogue
 * row takes the origin the library row carried. A library row with no origin —
 * an authored theme, or a copy whose catalogue entry is gone — stays its own
 * row.
 *
 * The rule is one function because the filter and the grid must not disagree
 * about which rows the state admits.
 */
function rowsFor(
  catalogue: readonly StoreItem[],
  library: readonly StoreItem[],
  state: LibraryState,
): readonly Row[] {
  const origins = new Map<string, CatalogueOrigin>();
  for (const item of library) {
    if (item.origin !== undefined) {
      origins.set(item.origin.catalogueId, item.origin);
    }
  }
  const store = withInstalledVersions(catalogue, library).map((item) => {
    const origin = origins.get(item.id);
    return origin === undefined ? item : { ...item, origin };
  });
  const libraryOnly = library.filter((item) => item.origin === undefined);
  const rows: readonly Row[] = [
    ...store.map((item): Row => ({ item, half: "store" })),
    ...libraryOnly.map((item): Row => ({ item, half: "library" })),
  ];

  if (state === "all") return rows;
  if (state === "on-this-pc") {
    return rows.filter(
      (row) => row.half === "library" || row.item.origin !== undefined,
    );
  }
  return rows.filter(
    (row) => row.half === "store" && row.item.origin === undefined,
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
  readonly onThemeDeleted?: ((id: string) => void) | undefined;
  readonly onThemePublished?: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const [client] = useState(() => props.client ?? createThemeLibraryClient());
  const clients = useMemo(() => hostClients(client), [client]);

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
              />
            ) : props.page === "submissions" ? (
              // Task 12 builds the author's listing. Until then the page says
              // only that it is not here yet: "no submissions" would be a
              // claim the dashboard grid's Mine half disproves.
              <Empty
                lead={uiCopy.library.submissionsPending}
                hint={undefined}
              />
            ) : (
              <PageListing
                page={props.page}
                state={props.state}
                clients={clients}
                onStatus={props.onStatus}
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setCatalogue(undefined);
    setLibrary(undefined);
    setCatalogueFailed(false);
    setLibraryFailed(false);
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
    return () => {
      live = false;
    };
  }, [sources, attempt]);

  const rows = useMemo(
    () => rowsFor(catalogue ?? [], library ?? [], props.state),
    [catalogue, library, props.state],
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

  // ponytail: navigation and the state filter are this task's; the cell's
  // actions and the install press land in Tasks 9–11.
  const install = useMemo<InstallControl>(
    () => ({
      onInstall: () => undefined,
      installingIds: new Set(),
      refusal: undefined,
      held: undefined,
      onApproveUpdate: () => undefined,
      onDismissUpdate: () => undefined,
    }),
    [],
  );

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
        {visible.length > 0 ? (
          <Gallery
            items={visible.map((row) => row.item)}
            density={density}
            onAction={(action) => {
              // Only "open" has a route in this task; the rest are Task 10's.
              // No per-type page has a document of its own to open yet.
              void action;
            }}
            onOpenItem={() => undefined}
            install={install}
          />
        ) : answered && !catalogueFailed && !libraryFailed ? (
          <div data-yunari-library-empty="">
            <Empty
              lead={uiCopy.library.empty}
              hint={uiCopy.library.emptyHint}
            />
          </div>
        ) : null}
      </div>
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
