import type {
  AssetPage,
  AssetResult,
  AssetSourceListing,
  ListingCategory,
  PresetKind,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import { Dialog } from "../components/ui/dialog.js";
import { Glyph, PREVIEW_GLYPH } from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import {
  fetchWallpaperEngine,
  type WallpaperEngineAnswer,
  type WallpaperEngineItem,
} from "../wallpaper-engine/client.js";
import { type AssetPlacement } from "./actions.js";
import { type ClientOptions, listSources, searchAssets } from "./client.js";
import { cardModelOf, type FinderCardModel } from "./finder-card.js";
import {
  ConnectionsButton,
  type FinderAction,
  FinderActionButton,
  FinderChip,
  FinderSegmented,
} from "./finder-controls.js";
import { FinderFrame } from "./finder-frame.js";
import { FinderGrid } from "./finder-grid.js";
import { FinderState } from "./finder-state.js";
import {
  FontPreviewPanel,
  type FontResult,
  type FontRole,
} from "./font-preview-panel.js";
import {
  type FontActions,
  type FontFilterState,
  type FontPreviewState,
  FontsFilter,
  fontActionsOf,
  fontDoneMessage,
  fontRows,
} from "./fonts.js";
import { type FinderPreview, FinderPreviewModal } from "./preview-modal.js";
import { FinderSkeleton } from "./skeleton.js";
import {
  appendAnswer,
  EMPTY_TAB,
  type FinderRow,
  hasMore,
  nextPages,
  resetForQuestion,
  retryPages,
  rowsOf,
  type TabData,
} from "./tab-data.js";
import {
  type WallpaperActions,
  WallpaperTools,
  wallpaperActionsOf,
  wallpaperCards,
} from "./wallpaper.js";

/** How long a keystroke settles before it is the query. */
export const SEARCH_DEBOUNCE_MS = 200;

const DISABLED_KEY = "yunari.asset-finder.disabled";

/** The kind filter's own value: every source, or one preset kind. */
type KindFilter = "all" | PresetKind;

/** The rail's fixed order (R1). A category the registry adds later that
 *  this list does not name appends alphabetically rather than disappearing. */
const CATEGORY_ORDER: readonly ListingCategory[] = [
  "font",
  "icon",
  "image",
  "video",
  "colour",
  "local",
];

/** One tab's accumulation and its own UI state, so switching tabs restores the
 *  question, the rows and the selection instead of resetting them. */
interface TabView {
  readonly data: TabData;
  readonly browsed: boolean;
  readonly loading: "first" | "more" | undefined;
  readonly selection: FinderRow | undefined;
  /** `failedId` names the result the sentence answers, so a later choice does
   *  not inherit its mark. */
  readonly message:
    | {
        readonly text: string;
        readonly tone: "ok" | "failed";
        readonly failedId?: string;
      }
    | undefined;
}

const EMPTY_VIEW: TabView = {
  data: EMPTY_TAB,
  browsed: false,
  loading: undefined,
  selection: undefined,
  message: undefined,
};

function emptyViews(): Record<ListingCategory, TabView> {
  const views = {} as Record<ListingCategory, TabView>;
  for (const category of CATEGORY_ORDER) views[category] = EMPTY_VIEW;
  return views;
}

export type ActionOutcome =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly message: string };

/** The Wallpaper Engine tab: a library fetched once, narrowed in memory. It
 *  has no page cursor and no request per keystroke, so it keeps its own small
 *  state rather than the search tabs' `TabData`. */
interface LocalView {
  readonly query: string;
  readonly kind: "all" | WallpaperEngineItem["kind"];
  readonly selection: WallpaperEngineItem | undefined;
  readonly done: ReadonlySet<string>;
  readonly message:
    | {
        readonly text: string;
        readonly tone: "ok" | "failed";
        readonly failedId?: string;
      }
    | undefined;
}

const EMPTY_LOCAL: LocalView = {
  query: "",
  kind: "all",
  selection: undefined,
  done: new Set(),
  message: undefined,
};

/** What the double-clicked card was: a search grid's row or a library item.
 *  The preview carries that target's own actions, not the footer's selection. */
type PreviewTarget =
  | { readonly kind: "asset"; readonly row: FinderRow }
  | { readonly kind: "local"; readonly item: WallpaperEngineItem };

export interface FinderProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The Fonts tab's session writes and role presets. Absent until the shell
   *  wires them; every font action is drawn from what this offers. */
  readonly font?: FontActions;
  /** The Wallpaper Engine tab's session writes. Absent makes the library
   *  read-only: the cards still draw and no action claims to run. */
  readonly wallpaper?: WallpaperActions;
  /** One row's action. `placement` names a second action — an image can be set
   *  as the theme's background or placed on the canvas — and is absent for the
   *  kind's own default. */
  readonly onAction: (
    page: AssetPage,
    result: AssetResult,
    placement?: AssetPlacement,
  ) => Promise<ActionOutcome>;
  /** Opens Settings on Connections; absent until the shell wires it. */
  readonly onOpenConnections?: () => void;
  /** The category to select once the listing arrives, when the caller asked
   *  for one (the font field opens on Fonts). */
  readonly initialCategory?: ListingCategory;
  readonly client?: ClientOptions;
}

function storedDisabled(): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(DISABLED_KEY) ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function gridSourcesOf(
  sources: readonly AssetSourceListing[],
  category: ListingCategory,
): readonly AssetSourceListing[] {
  // A font source searches through the same grid; its request body differs, not
  // its place in the window (R5).
  return sources.filter(
    (source) =>
      source.category === category &&
      (source.body === "grid" ||
        (category === "font" && source.body === "font-picker")),
  );
}

/** The source a result id names: the host prefixes ids `<source>:<entry>`. */
function sourceIdOf(result: AssetResult): string {
  const at = result.id.indexOf(":");
  return at === -1 ? result.id : result.id.slice(0, at);
}

/** The request field that says which editor body asks; the grid is the default
 *  and is spelled out so the host never has to infer it. */
function bodyOf(category: ListingCategory): "grid" | "font-picker" {
  return category === "font" ? "font-picker" : "grid";
}

/**
 * The finder: one modal, tabs derived from the registry's categories, one
 * mixed grid per grid category and a body per category that owns a component.
 *
 * **Browse on open and append as the author scrolls.** Each tab owns its own
 * question, rows, page cursor and selection; opening it asks page one of every
 * enabled source, and reaching the grid's end asks the next page of the
 * sources that say they have one. The grid only ever grows.
 *
 * A late answer is dropped by comparing a ticket on resolve; an abort alone
 * does not stop a response already in flight, so two searches racing would
 * otherwise leave the older one on screen. The ticket is per category, so a
 * tab's answer still lands while another tab is being read.
 */
export function AssetFinder({
  open,
  onOpenChange,
  font,
  wallpaper,
  onAction,
  onOpenConnections,
  initialCategory,
  client,
}: FinderProps): React.JSX.Element {
  const [sources, setSources] = useState<readonly AssetSourceListing[]>([]);
  const [listing, setListing] = useState<"loading" | "ok" | "failed">(
    "loading",
  );
  const [active, setActive] = useState<ListingCategory | undefined>(undefined);
  const [views, setViews] =
    useState<Record<ListingCategory, TabView>>(emptyViews);
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(storedDisabled);
  /** The Colours tab's kind filter. A palette and a gradient are different
   *  presets, so a question about one must not be answered with the other. */
  const [presetFilter, setPresetFilter] = useState<KindFilter>("all");
  /** The hosts the first host-contacting search reached, shown once.
   *  A search that reached none is not the disclosure: a person is told before
   *  the term leaves, not after. */
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const announced = useRef(false);
  const [busy, setBusy] = useState(false);
  /** The footer action whose write is out, so one spinner is not every one. */
  const [running, setRunning] = useState<string | undefined>(undefined);
  /** The Fonts tab's own filter and preview choices. Filtering and sorting
   *  narrow what is drawn; they never change what was asked. */
  const [fontFilter, setFontFilter] = useState<FontFilterState>({
    kind: "all",
    sort: "name",
  });
  const [fontPreview, setFontPreview] = useState<FontPreviewState>({
    sample: uiCopy.assets.fontPreview.sampleDefault,
    cutId: undefined,
    role: "body" as FontRole,
  });
  /** The Wallpaper Engine library, fetched on the tab's first activation, and
   *  the tab's own filter, selection and completed writes. */
  const [library, setLibrary] = useState<WallpaperEngineAnswer | undefined>();
  const [local, setLocal] = useState<LocalView>(EMPTY_LOCAL);
  const [localRunning, setLocalRunning] = useState<string | undefined>();
  /** The result the preview modal is showing, and the asset action it is
   *  running. The preview is a second surface over the finder, not a tab. */
  const [previewing, setPreviewing] = useState<PreviewTarget | undefined>();
  const [runningAsset, setRunningAsset] = useState<string | undefined>();
  const tickets = useRef(new Map<ListingCategory, number>());

  /** A category exists when the registry lists one, or when the session offers
   *  the writes a pane needs. */
  const present = (
    category: ListingCategory,
    listing: readonly AssetSourceListing[],
  ): boolean =>
    listing.some((source) => source.category === category) ||
    (category === "font" && font !== undefined) ||
    (category === "local" && wallpaper !== undefined);

  useEffect(() => {
    if (!open) return;

    let live = true;
    void listSources(client).then((next) => {
      if (!live) return;
      // A host that cannot be reached is a sentence, not an empty dialog: a
      // build without the asset routes and an absent host read the same here,
      // and both mean the finder cannot work.
      if (!next.ok) {
        setListing("failed");
        setSources([]);
        return;
      }
      setListing("ok");
      setSources(next.sources);
      const listed = next.sources;
      setActive((current) => {
        // A caller that names a category wins over the last one: the font
        // field opens Fonts every time, not only the first time.
        if (initialCategory !== undefined && present(initialCategory, listed)) {
          return initialCategory;
        }
        if (current !== undefined && present(current, listed)) return current;
        return listed[0]?.category ?? (font !== undefined ? "font" : "local");
      });
    });
    return () => {
      live = false;
    };
    // `font` is read for presence only; its callbacks are the session's.
  }, [open, client, initialCategory, font === undefined]);

  useEffect(() => {
    // A browser that refuses storage keeps the choice for this session only;
    // the chip is still the author's press, so throwing here would take the
    // modal down over a preference.
    try {
      localStorage.setItem(DISABLED_KEY, JSON.stringify([...disabled]));
    } catch {
      // No store: the disabled set lives in state for as long as the page does.
    }
  }, [disabled]);

  const presentCategories: ListingCategory[] = [];
  for (const source of sources) {
    if (!presentCategories.includes(source.category)) {
      presentCategories.push(source.category);
    }
  }
  for (const category of ["font", "local"] as const) {
    const offered =
      category === "font" ? font !== undefined : wallpaper !== undefined;
    if (offered && !presentCategories.includes(category)) {
      presentCategories.push(category);
    }
  }
  const categories: ListingCategory[] = [
    ...CATEGORY_ORDER.filter((category) =>
      presentCategories.includes(category),
    ),
    ...presentCategories
      .filter((category) => !CATEGORY_ORDER.includes(category))
      .sort(),
  ];

  const view = active === undefined ? EMPTY_VIEW : views[active];
  const gridSources =
    active === undefined ? [] : gridSourcesOf(sources, active);
  /** The kinds the tab's sources actually yield, never a fixed list. */
  const kinds = [
    ...new Set(
      gridSources
        .map((source) => source.presetKind)
        .filter((kind): kind is PresetKind => kind !== null),
    ),
  ];
  const kindOptions: readonly KindFilter[] = ["all", ...kinds];
  // The filter chooses which sources are asked; the chips' own persisted
  // choice is intersected with it, never rewritten by it.
  const visibleSources =
    presetFilter === "all"
      ? gridSources
      : gridSources.filter((source) => source.presetKind === presetFilter);
  const enabledSources = visibleSources.filter(
    (source) => !disabled.has(source.id),
  );
  const enabled = enabledSources.map((source) => source.id);
  const enabledKey = enabled.join("|");

  const bump = (category: ListingCategory): number => {
    const next = (tickets.current.get(category) ?? 0) + 1;
    tickets.current.set(category, next);
    return next;
  };
  const ticketOf = (category: ListingCategory): number =>
    tickets.current.get(category) ?? 0;
  const patch = (
    category: ListingCategory,
    update: (current: TabView) => TabView,
  ): void => {
    setViews((current) => ({
      ...current,
      [category]: update(current[category]),
    }));
  };

  /** A new question: what was shown answered the old one, so it leaves at the
   *  press that asked, and an answer already in flight is no longer wanted. */
  const askNew = (category: ListingCategory, query: string): void => {
    bump(category);
    patch(category, (current) => ({
      ...current,
      data: resetForQuestion(query),
      browsed: false,
      loading: undefined,
      selection: undefined,
      message: undefined,
    }));
  };

  useEffect(() => {
    if (!open || active === undefined) return undefined;
    // A body category draws its own component, and a tab whose sources are all
    // switched off has no question to ask.
    if (visibleSources.length === 0 || enabled.length === 0) return undefined;
    if (views[active].browsed) return undefined;

    const category = active;
    const question = views[category].data.query;
    const pages = nextPages(views[category].data, enabled);
    if (Object.keys(pages).length === 0) return undefined;
    const issued = bump(category);
    patch(category, (current) => ({ ...current, loading: "first" }));

    const timer = setTimeout(() => {
      void searchAssets(
        { query: question, enabled, pages, body: bodyOf(category) },
        client,
      ).then((next) => {
        if (issued !== ticketOf(category)) return;
        const reached = [
          ...new Set(
            enabledSources
              .filter((source) => enabled.includes(source.id))
              .map((source) => source.host)
              .filter((host): host is string => host !== null),
          ),
        ];
        if (!announced.current && reached.length > 0) {
          announced.current = true;
          setNotice(reached.join(", "));
        } else if (announced.current) {
          setNotice(undefined);
        }
        patch(category, (current) => ({
          ...current,
          data: appendAnswer(current.data, next.pages, pages),
          loading: undefined,
          browsed: true,
        }));
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `enabledKey` and `question` stand for the source list and the query:
    // `enabledSources` is a new array every render and would restart the timer.
  }, [open, active, view.browsed, view.data.query, enabledKey, client]);

  /** The Wallpaper Engine tab reads this PC's library once, on its first
   *  activation. It is not a search: nothing is asked again as the author
   *  types, and the filter narrows what already landed. */
  useEffect(() => {
    if (!open || active !== "local" || library !== undefined) return undefined;
    let live = true;
    void fetchWallpaperEngine(client).then((next) => {
      if (live) setLibrary(next);
    });
    return () => {
      live = false;
    };
  }, [open, active, library, client]);

  const loadMore = (): void => {
    if (active === undefined) return;
    const category = active;
    const current = views[category];
    if (current.loading !== undefined || !current.browsed) return;
    const pages = nextPages(current.data, enabled);
    if (Object.keys(pages).length === 0) return;

    const issued = bump(category);
    patch(category, (view) => ({ ...view, loading: "more" }));
    void searchAssets(
      {
        query: current.data.query,
        enabled,
        pages,
        body: bodyOf(category),
      },
      client,
    ).then((next) => {
      if (issued !== ticketOf(category)) return;
      patch(category, (view) => ({
        ...view,
        data: appendAnswer(view.data, next.pages, pages),
        loading: undefined,
      }));
    });
  };

  /** Ask again the page each refused source failed on. A success clears that
   *  source's failure in `appendAnswer`, so the sentence leaves with the rows. */
  const retry = (): void => {
    if (active === undefined) return;
    const category = active;
    const pages = retryPages(views[category].data, enabled);
    if (Object.keys(pages).length === 0) return;

    const issued = bump(category);
    patch(category, (view) => ({ ...view, loading: "first" }));
    void searchAssets(
      {
        query: views[category].data.query,
        enabled,
        pages,
        body: bodyOf(category),
      },
      client,
    ).then((next) => {
      if (issued !== ticketOf(category)) return;
      patch(category, (view) => ({
        ...view,
        data: appendAnswer(view.data, next.pages, pages),
        loading: undefined,
        browsed: true,
      }));
    });
  };

  const sourceOf = (id: string): AssetSourceListing | undefined =>
    sources.find((source) => source.id === id);

  const runRow = async (
    category: ListingCategory,
    row: FinderRow,
    placement?: AssetPlacement,
  ): Promise<ActionOutcome> => {
    setBusy(true);
    const outcome = await onAction(row.page, row.result, placement);
    setBusy(false);
    patch(category, (current) => ({
      ...current,
      message: {
        text: outcome.message ?? uiCopy.assets.done[category],
        tone: outcome.ok ? "ok" : "failed",
        ...(outcome.ok ? {} : { failedId: row.result.id }),
      },
    }));
    return outcome;
  };

  if (listing !== "ok") {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        label={uiCopy.assets.title}
        closeLabel={uiCopy.assets.close}
        closeIcon
        className="editor-shell-dialog--finder"
      >
        {listing === "failed" ? (
          <p
            className="p-[var(--space-16)] text-sm text-muted"
            data-yunari-asset-host-failure=""
          >
            {uiCopy.assets.hostUnavailable}
          </p>
        ) : (
          <div
            data-yunari-asset-listing-skeleton=""
            className="min-h-0 flex-1 overflow-y-auto p-[var(--space-16)]"
          >
            <FinderSkeleton />
          </div>
        )}
      </Dialog>
    );
  }

  if (active === undefined) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        label={uiCopy.assets.title}
        closeLabel={uiCopy.assets.close}
        closeIcon
        className="editor-shell-dialog--finder"
      >
        <p className="p-[var(--space-16)] text-sm text-muted">
          {uiCopy.assets.noSource}
        </p>
      </Dialog>
    );
  }

  /** The Wallpaper Engine tab draws the same frame, card and grid, but its
   *  content is a listing rather than an answer. */
  const isLocal = active === "local";
  const isGrid = isLocal || gridSources.length > 0;
  const libraryItems = library?.available === true ? library.items : [];
  const localUnavailable =
    library !== undefined && library.available === false
      ? uiCopy.assets.wallpaperEngine.reason[library.reason]
      : undefined;
  const localNeedle = local.query.trim().toLowerCase();
  const localShown = libraryItems.filter(
    (item) =>
      (local.kind === "all" || item.kind === local.kind) &&
      (localNeedle === "" || item.title.toLowerCase().includes(localNeedle)),
  );
  const rows = rowsOf(view.data, enabled);
  /** What the grid draws: the tab's own filter can narrow a font answer
   *  without touching what was asked or kept. */
  const shown = active === "font" ? fontRows(rows, fontFilter) : rows;
  const more = isGrid && hasMore(view.data, enabled);
  const failures = [...view.data.failures.values()];
  /** A keyed source in trouble is the one reason to offer Connections: a
   *  refused key can reach the host as a plain failure, so the control follows
   *  the source's declaration, not the reason it reports. */
  const needsConnections = failures.some(
    (page) =>
      page.failure?.reason === "needs-credential" ||
      (sourceOf(page.source)?.requires ?? null) !== null,
  );
  const pendingFirst = !view.browsed || view.loading === "first";
  const kindSourcesOff = visibleSources.length > 0 && enabled.length === 0;

  const selectionId =
    view.selection === undefined
      ? undefined
      : `${view.selection.page.source}:${view.selection.result.id}`;
  const busyId =
    busy && view.selection !== undefined ? view.selection.result.id : undefined;
  const failedId = view.message?.failedId;

  const failureSentence = (page: AssetPage): React.ReactNode => {
    const failure = page.failure;
    if (failure === undefined) return null;
    const label = sourceOf(page.source)?.label ?? page.source;
    return failure.reason === "needs-credential" ? (
      <span key={page.source} data-yunari-asset-needs-credential={page.source}>
        {uiCopy.assets.needsCredential(label)}{" "}
      </span>
    ) : (
      <span key={page.source} data-yunari-asset-failure={page.source}>
        {uiCopy.assets.sourceFailed(label, failure.message)}{" "}
      </span>
    );
  };

  /** One line, in priority order. */
  const statusNode: React.ReactNode = isLocal ? (
    local.message === undefined ? undefined : (
      <span data-yunari-asset-message="">{local.message.text}</span>
    )
  ) : isGrid ? (
    view.message !== undefined ? (
      <span data-yunari-asset-message="">{view.message.text}</span>
    ) : view.loading !== undefined ? (
      uiCopy.assets.searching(enabled.length)
    ) : failures.length > 0 ? (
      <>
        {failures.map(failureSentence)}
        {failures.some((page) => page.failure?.reason === "failed") ? (
          <button
            type="button"
            data-yunari-asset-retry=""
            onClick={retry}
            className="underline"
          >
            {uiCopy.assets.retry}
          </button>
        ) : null}
      </>
    ) : shown.length > 0 ? (
      `${uiCopy.assets.results(
        shown.length,
        new Set(shown.map((row) => sourceIdOf(row.result))).size,
      )}${more ? "" : ` · ${uiCopy.assets.endOfResults}`}`
    ) : undefined
  ) : undefined;
  const statusTone: "ok" | "failed" | undefined = isLocal
    ? local.message?.tone
    : (view.message?.tone ?? (failures.length > 0 ? "failed" : undefined));

  /** The same two actions, built for whichever row they are about: the footer's
   *  selection, or a card the author double-clicked. */
  const assetActionsFor = (
    row: FinderRow | undefined,
  ): readonly FinderAction[] => {
    const run =
      (placement?: AssetPlacement): FinderAction["run"] =>
      () =>
        row === undefined
          ? Promise.resolve({ ok: false, message: uiCopy.assets.noSelection })
          : runRow(active, row, placement);
    const place: FinderAction = {
      id: "place",
      label: uiCopy.assets.placeOnCanvas,
      busyLabel: uiCopy.assets.busy.icon,
      tone: "plain",
      disabled: row === undefined || busy,
      run: run("place"),
    };
    const main: FinderAction = {
      id: "apply",
      label: uiCopy.assets.action[active],
      busyLabel: uiCopy.assets.busy[active],
      tone: "accent",
      disabled: row === undefined || busy,
      run: run(active === "image" ? "background" : undefined),
    };
    return active === "image" ? [place, main] : [main];
  };
  const footerAsset = assetActionsFor(view.selection);

  const cards: readonly FinderCardModel[] = shown.map(({ page, result }) =>
    cardModelOf(result, sourceOf(page.source)?.label ?? page.source),
  );
  const rowOfCard = (card: FinderCardModel): FinderRow | undefined =>
    shown.find(
      ({ page, result }) =>
        result.id === card.id && page.source === card.sourceId,
    );

  /** The Fonts tab's footer actions, built from the chosen result and the
   *  column's own choices. Actions are the session's; a callback it does not
   *  wire drops its button. */
  const fontFooter: readonly FinderAction[] =
    active === "font" && view.selection !== undefined
      ? fontActionsOf(view.selection, fontFilter, fontPreview, font)
      : [];
  const fontSelection: FontResult | undefined =
    active === "font" && view.selection?.result.font !== undefined
      ? (view.selection.result as FontResult)
      : undefined;

  const runFontAction = (action: FinderAction): void => {
    setRunning(action.id);
    const rowId = view.selection?.result.id;
    const outcome = action.run();
    void Promise.resolve(outcome).then((result) => {
      setRunning(undefined);
      patch(active, (current) => ({
        ...current,
        message: {
          text: result.ok ? fontDoneMessage(action.id) : result.message,
          tone: result.ok ? "ok" : "failed",
          ...(result.ok || rowId === undefined ? {} : { failedId: rowId }),
        },
      }));
    });
  };

  /** The Wallpaper Engine tab's footer, built from the chosen item, and the
   *  write it runs. A success marks that card done for the modal session. */
  const localFooter: readonly FinderAction[] = isLocal
    ? wallpaperActionsOf(local.selection, wallpaper)
    : [];
  const runLocalAction = (
    action: FinderAction,
    item: WallpaperEngineItem | undefined = local.selection,
  ): void => {
    setLocalRunning(action.id);
    void Promise.resolve(action.run()).then((result) => {
      setLocalRunning(undefined);
      setLocal((current) => ({
        ...current,
        done:
          result.ok && item !== undefined
            ? new Set([...current.done, item.workshopId])
            : current.done,
        message: {
          text: result.message ?? uiCopy.assets.done.local,
          tone: result.ok ? "ok" : "failed",
          ...(result.ok || item === undefined
            ? {}
            : { failedId: item.workshopId }),
        },
      }));
    });
  };
  const selectLocal = (card: FinderCardModel): void => {
    const item = localShown.find((entry) => entry.workshopId === card.id);
    if (item !== undefined)
      setLocal((current) => ({ ...current, selection: item }));
  };

  /** Only a picture has something to enlarge: an icon, palette, gradient or
   *  face keeps its single-press selection and no Preview button. */
  const previewableSelection = isLocal
    ? local.selection !== undefined
    : active !== "font" && view.selection?.result.kind === "image";

  const openSelectionPreview = (): void => {
    if (isLocal) {
      if (local.selection !== undefined) {
        setPreviewing({ kind: "local", item: local.selection });
      }
      return;
    }
    const row = view.selection;
    if (row !== undefined && row.result.kind === "image") {
      setPreviewing({ kind: "asset", row });
    }
  };

  const previewModel = (target: PreviewTarget): FinderPreview => {
    if (target.kind === "local") {
      const copy = uiCopy.assets.wallpaperEngine;
      return {
        id: target.item.workshopId,
        name: target.item.title,
        meta: `${copy.kind[target.item.kind]} · ${copy.size(target.item.filesize)}`,
        licence: "unknown",
        sourceUrl: target.item.attribution?.workshopUrl ?? "",
        imageUrl: target.item.previewUrl,
        posterOnly: target.item.kind === "video",
      };
    }
    const result = target.row.result;
    return {
      id: result.id,
      name: result.name,
      meta: result.subtitle ?? "",
      licence: result.licence,
      sourceUrl: result.sourceUrl,
      imageUrl: result.preview === "" ? undefined : result.preview,
      posterOnly: result.kind === "video",
    };
  };

  const previewActions: readonly FinderAction[] =
    previewing === undefined
      ? []
      : previewing.kind === "local"
        ? wallpaperActionsOf(previewing.item, wallpaper)
        : assetActionsFor(previewing.row);
  const previewMessage =
    previewing === undefined
      ? undefined
      : previewing.kind === "local"
        ? local.message
        : view.message;
  const previewBusy =
    previewing === undefined
      ? undefined
      : previewing.kind === "local"
        ? localRunning
        : runningAsset;

  const runPreviewAction = (action: FinderAction): void => {
    if (previewing === undefined) return;
    if (previewing.kind === "local") {
      runLocalAction(action, previewing.item);
      return;
    }
    setRunningAsset(action.id);
    void Promise.resolve(action.run()).finally(() => {
      setRunningAsset(undefined);
    });
  };

  const emptyState = (): React.ReactNode => {
    if (kindSourcesOff) {
      return (
        <div data-yunari-asset-kind-off="">
          <FinderState message={uiCopy.assets.kindSourcesOff} />
        </div>
      );
    }
    if (pendingFirst) {
      return (
        <div
          data-yunari-asset-loading=""
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <FinderSkeleton />
        </div>
      );
    }
    // A missing key is not the query's fault, and retrying cannot install one:
    // the body offers the control that can.
    if (
      failures.length > 0 &&
      failures.every((page) => page.failure?.reason === "needs-credential")
    ) {
      return (
        <div data-yunari-asset-needs-key="">
          <FinderState
            message={uiCopy.assets.needsKeyBody}
            {...(onOpenConnections === undefined
              ? {}
              : {
                  action: {
                    label: uiCopy.assets.connectionsAction,
                    onClick: onOpenConnections,
                  },
                })}
          />
        </div>
      );
    }
    if (failures.length > 0) {
      return (
        <div data-yunari-asset-failed="">
          <FinderState
            message={uiCopy.assets.emptyAfterFailure}
            action={{ label: uiCopy.assets.retry, onClick: retry }}
          />
        </div>
      );
    }
    // The tab's filter can hide every row an answer did bring; that is not a
    // failed question, so the query is not offered for clearing.
    if (rows.length > 0) {
      return (
        <div data-yunari-asset-empty="">
          <FinderState message={uiCopy.assets.noResults} />
        </div>
      );
    }
    if (view.data.query === "") {
      return (
        <div data-yunari-asset-nothing="">
          <FinderState message={uiCopy.assets.nothingToBrowse} />
        </div>
      );
    }
    return (
      <div data-yunari-asset-empty="">
        <FinderState
          message={uiCopy.assets.noResults}
          action={{
            label: uiCopy.assets.clearQuery,
            onClick: () => askNew(active, ""),
            data: { "data-yunari-asset-clear-query": "" },
          }}
        />
      </div>
    );
  };

  return (
    <>
      <FinderFrame
        open={open}
        onOpenChange={(next) => {
          // While the preview is over the finder, the preview is what a close
          // closes: the finder would otherwise go with it.
          if (!next && previewing !== undefined) return;
          onOpenChange(next);
        }}
        label={uiCopy.assets.title}
        closeLabel={uiCopy.assets.close}
        className="editor-shell-dialog--finder"
        tabs={categories.map((category) => ({
          id: category,
          label: uiCopy.assets.category[category],
        }))}
        active={active}
        onTabChange={(category) => {
          // The kind filter belongs to the Colours tab: it neither follows the
          // author to the next tab nor leaves Colours' rows answering a
          // narrower question than the chip will show on the way back.
          if (presetFilter !== "all") {
            setPresetFilter("all");
            askNew("colour", views.colour.data.query);
          }
          setActive(category);
        }}
        {...(isGrid
          ? isLocal
            ? {
                query: local.query,
                searchPlaceholder: uiCopy.assets.search[active],
                onQueryChange: (value: string) => {
                  setLocal((current) => ({ ...current, query: value }));
                },
              }
            : {
                query: view.data.query,
                searchPlaceholder: uiCopy.assets.search[active],
                onQueryChange: (value: string) => askNew(active, value),
              }
          : {})}
        filters={
          active === "font" ? (
            <FontsFilter
              filter={fontFilter}
              onChange={(next) => {
                setFontFilter(next);
              }}
            />
          ) : isLocal ? (
            <FinderSegmented
              label={uiCopy.assets.wallpaperEngine.filterKind}
              value={local.kind}
              options={(["all", "video", "scene"] as const).map((kind) => ({
                id: kind,
                label:
                  kind === "all"
                    ? uiCopy.assets.wallpaperEngine.filterAll
                    : uiCopy.assets.wallpaperEngine.kind[kind],
                data: { "data-yunari-wallpaper-engine-kind-filter": kind },
              }))}
              onChange={(kind) => {
                setLocal((current) => ({ ...current, kind }));
              }}
            />
          ) : active === "colour" && kinds.length > 1 ? (
            <FinderSegmented
              label={uiCopy.assets.kindFilterLabel}
              value={presetFilter}
              options={kindOptions.map((kind) => ({
                id: kind,
                label: uiCopy.assets.kindFilter[kind],
                data: { "data-yunari-asset-kind": kind },
              }))}
              onChange={(kind) => {
                setPresetFilter(kind);
                askNew(active, view.data.query);
              }}
            />
          ) : undefined
        }
        sources={
          visibleSources.length > 1 ? (
            <>
              {visibleSources.map((source) => {
                const off = disabled.has(source.id);
                const failed = view.data.failures.has(source.id);
                return (
                  <FinderChip
                    key={source.id}
                    label={source.label}
                    pressed={!off}
                    failed={failed}
                    disabled={!source.configurable}
                    data={
                      off
                        ? {
                            "data-yunari-asset-chip": source.id,
                            "data-disabled": "",
                          }
                        : { "data-yunari-asset-chip": source.id }
                    }
                    onToggle={() => {
                      setDisabled((current) => {
                        const next = new Set(current);
                        if (next.has(source.id)) next.delete(source.id);
                        else if (
                          enabled.length > 1 ||
                          !visibleSources.some((entry) => !next.has(entry.id))
                        ) {
                          next.add(source.id);
                        }
                        return next;
                      });
                      askNew(active, view.data.query);
                    }}
                  />
                );
              })}
            </>
          ) : undefined
        }
        tools={
          <>
            {isLocal ? (
              <WallpaperTools
                onImportPackage={wallpaper?.onImportPackage}
                onStatus={(message) => {
                  setLocal((current) => ({
                    ...current,
                    message: { text: message, tone: "ok" },
                  }));
                }}
              />
            ) : null}
            <ConnectionsButton
              needs={needsConnections}
              onOpen={() => onOpenConnections?.()}
            />
          </>
        }
        status={statusNode}
        {...(statusTone === undefined ? {} : { statusTone })}
        {...(fontSelection === undefined
          ? {}
          : {
              detail: (
                <FontPreviewPanel
                  selected={fontSelection}
                  presets={font?.presets ?? {}}
                  state={fontPreview}
                  onChange={setFontPreview}
                />
              ),
            })}
        actions={
          isGrid ? (
            <>
              {previewableSelection ? (
                <ControlIconButton
                  label={uiCopy.assets.previewOpen}
                  data={{ "data-yunari-asset-preview-open": "" }}
                  onClick={openSelectionPreview}
                >
                  <Glyph icon={PREVIEW_GLYPH} size={14} />
                </ControlIconButton>
              ) : null}
              {isLocal
                ? localFooter.map((action) => (
                    <FinderActionButton
                      key={action.id}
                      action={action}
                      busy={localRunning === action.id}
                      onRun={() => runLocalAction(action)}
                      data={{ "data-yunari-asset-action": "" }}
                    />
                  ))
                : active === "font"
                  ? fontFooter.map((action) => (
                      <FinderActionButton
                        key={action.id}
                        action={action}
                        busy={running === action.id}
                        onRun={() => runFontAction(action)}
                        data={
                          action.tone === "accent"
                            ? { "data-yunari-asset-action": "" }
                            : { "data-yunari-font-action": action.id }
                        }
                      />
                    ))
                  : footerAsset.map((action) => (
                      <FinderActionButton
                        key={action.id}
                        action={action}
                        busy={busy}
                        onRun={() => {
                          void action.run();
                        }}
                        data={
                          action.id === "place"
                            ? { "data-yunari-asset-place": "" }
                            : { "data-yunari-asset-action": "" }
                        }
                      />
                    ))}
            </>
          ) : undefined
        }
      >
        {!isGrid ? (
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            data-yunari-asset-body={active}
          >
            <FinderState message={uiCopy.assets.noSource} />
          </div>
        ) : isLocal ? (
          localUnavailable !== undefined ? (
            <div
              data-yunari-wallpaper-engine-unavailable=""
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <FinderState message={localUnavailable} />
            </div>
          ) : library === undefined ? (
            <div
              data-yunari-asset-loading=""
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <FinderSkeleton />
            </div>
          ) : libraryItems.length === 0 ? (
            <div
              data-yunari-wallpaper-engine-empty=""
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <FinderState message={uiCopy.assets.wallpaperEngine.empty} />
            </div>
          ) : localShown.length === 0 ? (
            <div
              data-yunari-wallpaper-engine-no-matches=""
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <FinderState message={uiCopy.assets.wallpaperEngine.noMatches} />
            </div>
          ) : (
            <div
              data-yunari-asset-grid=""
              className="flex min-h-0 flex-1 flex-col"
            >
              <FinderGrid
                label={uiCopy.assets.category.local}
                cards={wallpaperCards(localShown)}
                selectedId={
                  local.selection === undefined
                    ? undefined
                    : `wallpaper-engine:${local.selection.workshopId}`
                }
                {...(localRunning === undefined || local.selection === undefined
                  ? {}
                  : { busyId: local.selection.workshopId })}
                {...(local.message?.failedId === undefined
                  ? {}
                  : { failedId: local.message.failedId })}
                {...(local.done.size === 0 ? {} : { doneIds: local.done })}
                onSelect={selectLocal}
                onPreview={(card) => {
                  const item = localShown.find(
                    (entry) => entry.workshopId === card.id,
                  );
                  if (item !== undefined)
                    setPreviewing({ kind: "local", item });
                }}
                onApply={(card) => {
                  const item = localShown.find(
                    (entry) => entry.workshopId === card.id,
                  );
                  setLocal((current) => ({ ...current, selection: item }));
                  const first = wallpaperActionsOf(item, wallpaper)[0];
                  if (first !== undefined) runLocalAction(first, item);
                }}
                onNeedMore={() => {}}
                canLoadMore={false}
                appending={false}
              />
            </div>
          )
        ) : (
          <>
            {notice === undefined ? null : (
              <p
                className="text-xs text-muted"
                data-yunari-asset-host-notice=""
              >
                {uiCopy.assets.remoteHostNotice(notice)}
              </p>
            )}

            {shown.length === 0 ? (
              emptyState()
            ) : (
              <div
                data-yunari-asset-grid=""
                aria-busy={view.loading !== undefined ? "true" : undefined}
                className="flex min-h-0 flex-1 flex-col"
              >
                <FinderGrid
                  // A question or a tab is a new grid: the scroll starts at the
                  // top and the roving focus at the first card.
                  key={`${active}:${view.data.query}`}
                  label={uiCopy.assets.category[active]}
                  cards={cards}
                  selectedId={selectionId}
                  {...(busyId === undefined ? {} : { busyId })}
                  {...(failedId === undefined ? {} : { failedId })}
                  onSelect={(card) => {
                    const row = rowOfCard(card);
                    if (row !== undefined) {
                      patch(active, (current) => ({
                        ...current,
                        selection: row,
                      }));
                      // A cut belongs to the family that listed it.
                      if (active === "font") {
                        setFontPreview((current) => ({
                          ...current,
                          cutId: undefined,
                        }));
                      }
                    }
                  }}
                  onPreview={(card) => {
                    // Double-click enlarges a picture; every other kind has no
                    // larger form and keeps its single-press selection.
                    const row = rowOfCard(card);
                    if (row !== undefined && row.result.kind === "image") {
                      setPreviewing({ kind: "asset", row });
                    }
                  }}
                  onApply={(card) => {
                    const row = rowOfCard(card);
                    if (row === undefined) return;
                    patch(active, (current) => ({
                      ...current,
                      selection: row,
                    }));
                    if (active === "font") {
                      const first = fontActionsOf(
                        row,
                        fontFilter,
                        fontPreview,
                        font,
                      )[0];
                      if (first !== undefined) runFontAction(first);
                      return;
                    }
                    void runRow(
                      active,
                      row,
                      active === "image" ? "background" : undefined,
                    );
                  }}
                  onNeedMore={loadMore}
                  canLoadMore={more && view.loading === undefined}
                  appending={view.loading === "more"}
                />
              </div>
            )}
          </>
        )}
      </FinderFrame>
      <FinderPreviewModal
        preview={
          previewing === undefined ? undefined : previewModel(previewing)
        }
        actions={previewActions}
        busyActionId={previewBusy}
        message={previewMessage}
        onRun={runPreviewAction}
        onClose={() => {
          setPreviewing(undefined);
        }}
      />
    </>
  );
}
