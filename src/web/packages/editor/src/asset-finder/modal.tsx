import type {
  AssetPage,
  AssetResult,
  AssetSourceListing,
  ListingCategory,
  PresetKind,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../components/ui/dialog.js";
import { uiCopy } from "../ui-copy.js";
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
  fontRows,
} from "./fonts.js";
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

/** How long a keystroke settles before it is the query. */
export const SEARCH_DEBOUNCE_MS = 200;

const DISABLED_KEY = "yunari.asset-finder.disabled";

/** The kind filter's own value: every source, or one preset kind. */
type KindFilter = "all" | PresetKind;

/** The rail's fixed order (spec R1). A category the registry adds later that
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
  readonly message:
    | { readonly text: string; readonly tone: "ok" | "failed" }
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

export interface FinderProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The Fonts tab's session writes and role presets. Absent until the shell
   *  wires them; every font action is drawn from what this offers. */
  readonly font?: FontActions;
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
  // its place in the window (spec R5).
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
  /** The hosts the first host-contacting search reached, shown once (spec §5).
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
  const tickets = useRef(new Map<ListingCategory, number>());

  /** A font category exists when the registry lists one, or when the session
   *  offers the writes a pane needs. */
  const present = (
    category: ListingCategory,
    listing: readonly AssetSourceListing[],
  ): boolean =>
    listing.some((source) => source.category === category) ||
    (category === "font" && font !== undefined);

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
  for (const category of ["font"] as const) {
    if (font !== undefined && !presentCategories.includes(category)) {
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

  const isGrid = gridSources.length > 0;
  const rows = rowsOf(view.data, enabled);
  /** What the grid draws: the tab's own filter can narrow a font answer
   *  without touching what was asked or kept. */
  const shown = active === "font" ? fontRows(rows, fontFilter) : rows;
  const more = isGrid && hasMore(view.data, enabled);
  const failures = [...view.data.failures.values()];
  /** A key that is missing or refused is the one reason to offer Connections:
   *  a control that cannot help is not an availability. */
  const needsConnections = failures.some(
    (page) => page.failure?.reason === "needs-credential",
  );
  const pendingFirst = !view.browsed || view.loading === "first";
  const kindSourcesOff = visibleSources.length > 0 && enabled.length === 0;

  const selectionId =
    view.selection === undefined
      ? undefined
      : `${view.selection.page.source}:${view.selection.result.id}`;
  const busyId =
    busy && view.selection !== undefined ? view.selection.result.id : undefined;
  const failedId =
    view.message?.tone === "failed" && view.selection !== undefined
      ? view.selection.result.id
      : undefined;

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

  /** One line, in the spec's priority order. */
  const statusNode: React.ReactNode = isGrid ? (
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
  const statusTone: "ok" | "failed" | undefined =
    view.message?.tone ?? (failures.length > 0 ? "failed" : undefined);

  const placeAction: FinderAction = {
    id: "place",
    label: uiCopy.assets.placeOnCanvas,
    busyLabel: uiCopy.assets.busy.icon,
    tone: "plain",
    disabled: view.selection === undefined || busy,
    run: () => {
      const row = view.selection;
      return row === undefined
        ? Promise.resolve({ ok: false, message: uiCopy.assets.noSelection })
        : runRow(active, row, "place");
    },
  };
  const mainAction: FinderAction = {
    id: "apply",
    label: uiCopy.assets.action[active],
    busyLabel: uiCopy.assets.busy[active],
    tone: "plain",
    disabled: view.selection === undefined || busy,
    run: () => {
      const row = view.selection;
      return row === undefined
        ? Promise.resolve({ ok: false, message: uiCopy.assets.noSelection })
        : runRow(active, row, active === "image" ? "background" : undefined);
    },
  };

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
    const outcome = action.run();
    void Promise.resolve(outcome).then((result) => {
      setRunning(undefined);
      patch(active, (current) => ({
        ...current,
        message: {
          text: result.ok
            ? action.id.startsWith("add")
              ? uiCopy.assets.done.colour
              : uiCopy.assets.done.font
            : result.message,
          tone: result.ok ? "ok" : "failed",
        },
      }));
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
    <FinderFrame
      open={open}
      onOpenChange={onOpenChange}
      label={uiCopy.assets.title}
      closeLabel={uiCopy.assets.close}
      className="editor-shell-dialog--finder"
      tabs={categories.map((category) => ({
        id: category,
        label: uiCopy.assets.category[category],
      }))}
      active={active}
      onTabChange={(category) => {
        // A filter belongs to the tab that drew it: the next tab starts at
        // "all", and if this one's filter had narrowed the sources its stored
        // rows answer a question it no longer asks.
        if (presetFilter !== "all") {
          setPresetFilter("all");
          askNew(category, views[category].data.query);
        }
        setActive(category);
      }}
      {...(isGrid
        ? {
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
        <ConnectionsButton
          needs={needsConnections}
          onOpen={() => onOpenConnections?.()}
        />
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
          active === "font" ? (
            <>
              {fontFooter.map((action) => (
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
              ))}
            </>
          ) : (
            <>
              {active === "image" ? (
                <FinderActionButton
                  action={placeAction}
                  busy={busy}
                  onRun={() => {
                    void placeAction.run();
                  }}
                  data={{ "data-yunari-asset-place": "" }}
                />
              ) : null}
              <FinderActionButton
                action={mainAction}
                busy={busy}
                onRun={() => {
                  void mainAction.run();
                }}
                data={{ "data-yunari-asset-action": "" }}
              />
            </>
          )
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
      ) : (
        <>
          {notice === undefined ? null : (
            <p className="text-xs text-muted" data-yunari-asset-host-notice="">
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
                onPreview={() => {
                  // The preview modal lands in Task 4.2.
                }}
                onApply={(card) => {
                  const row = rowOfCard(card);
                  if (row === undefined) return;
                  patch(active, (current) => ({ ...current, selection: row }));
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
  );
}
