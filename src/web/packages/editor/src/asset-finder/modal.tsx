import type {
  AssetPage,
  AssetResult,
  AssetSearchAnswer,
  AssetSourceListing,
  ListingCategory,
  PresetKind,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../components/ui/dialog.js";
import {
  Glyph,
  NEXT_PAGE_GLYPH,
  PREVIOUS_PAGE_GLYPH,
} from "../editor-shell/icons.js";
import { pageNumbers } from "../store-mode/pager.js";
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
import { interleave } from "./interleave.js";
import { FinderSkeleton } from "./skeleton.js";

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

export type ActionOutcome =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly message: string };

export interface FinderProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The category whose body is a component, never a grid. */
  readonly bodies: Readonly<
    Record<"font-picker" | "wallpaper-engine", React.ReactNode>
  >;
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
  return sources.filter(
    (source) => source.category === category && source.body === "grid",
  );
}

/** The source a result id names: the host prefixes ids `<source>:<entry>`. */
function sourceIdOf(result: AssetResult): string {
  const at = result.id.indexOf(":");
  return at === -1 ? result.id : result.id.slice(0, at);
}

type Row = { readonly page: AssetPage; readonly result: AssetResult };

/** The interleaved rows, each still paired with the page it answered on, so a
 *  row's action and its source mark need no second lookup. */
function rowsIn(pages: readonly AssetPage[]): readonly Row[] {
  const pagesOf = new Map<AssetResult, AssetPage>();
  for (const page of pages) {
    for (const result of page.results) pagesOf.set(result, page);
  }

  return interleave(pages, []).flatMap((result) => {
    const page = pagesOf.get(result);
    return page === undefined ? [] : [{ page, result }];
  });
}

/** How many pages the answer has: the furthest its sources reach. A source that
 *  cannot say — Unsplash on a blank term — leaves the count at what it was. */
function totalPagesOf(pages: readonly AssetPage[]): number {
  let total = 1;
  for (const page of pages) {
    if (page.totalPages !== undefined) total = Math.max(total, page.totalPages);
  }
  return total;
}

/** The numbered pages, the theme store's own numerals and window. */
function FinderPager({
  page,
  total,
  onPage,
}: {
  readonly page: number;
  readonly total: number;
  readonly onPage: (page: number) => void;
}): React.JSX.Element {
  const step =
    "inline-flex size-[26px] flex-none items-center justify-center rounded-md border border-transparent text-sm disabled:text-faint";
  return (
    <nav
      aria-label={uiCopy.assets.pager.pages}
      data-yunari-asset-pager=""
      className="flex items-center gap-[var(--space-4)]"
    >
      <button
        type="button"
        aria-label={uiCopy.assets.pager.previous}
        data-yunari-asset-page-previous=""
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={`${step} text-muted hover:border-edge`}
      >
        <Glyph icon={PREVIOUS_PAGE_GLYPH} size={14} />
      </button>
      {pageNumbers(page, total).map((entry, at) =>
        entry === "gap" ? (
          <span
            // The index is the key: two gaps can be drawn at once and neither is
            // a page the pager could name.
            key={`gap-${at}`}
            aria-hidden="true"
            data-yunari-asset-page-gap=""
            className="inline-flex size-[26px] flex-none items-center justify-center text-sm text-muted"
          >
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            aria-label={uiCopy.assets.pager.page(entry)}
            aria-current={entry === page ? "page" : undefined}
            data-yunari-asset-page={entry}
            onClick={() => onPage(entry)}
            className={`${step} font-mono ${
              entry === page
                ? "[background:var(--stage)] font-medium text-text"
                : "text-muted hover:border-edge"
            }`}
          >
            {entry}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label={uiCopy.assets.pager.next}
        data-yunari-asset-page-next=""
        disabled={page >= total}
        onClick={() => onPage(page + 1)}
        className={`${step} text-muted hover:border-edge`}
      >
        <Glyph icon={NEXT_PAGE_GLYPH} size={14} />
      </button>
    </nav>
  );
}

/**
 * The finder: one modal, tabs derived from the registry's categories, one
 * mixed grid per grid category and a body per category that owns a component.
 *
 * **One page at a time, numbered like the store's catalogue.** Every source is
 * asked for the same page, the grid shows exactly that page, and the pager's
 * count is the furthest source's — a source that ends sooner simply stops
 * contributing. A question — a term, a chip, a tab — returns to page one,
 * because a page the new question never had is not a page.
 *
 * A late answer is dropped by comparing a ticket on resolve; an abort alone
 * does not stop a response already in flight, so two searches racing would
 * otherwise leave the older one on screen.
 */
export function AssetFinder({
  open,
  onOpenChange,
  bodies,
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
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [answer, setAnswer] = useState<AssetSearchAnswer | undefined>(
    undefined,
  );
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(storedDisabled);
  /** The Colours tab's kind filter. A palette and a gradient are different
   *  presets, so a question about one must not be answered with the other. */
  const [presetFilter, setPresetFilter] = useState<KindFilter>("all");
  const [selected, setSelected] = useState<Row | undefined>(undefined);
  /** The sources that failed on this page, with their own sentence. */
  const [failures, setFailures] = useState<readonly AssetPage[]>([]);
  /** The hosts the first host-contacting search reached, shown once (spec §5).
   *  A search that reached none is not the disclosure: a person is told before
   *  the term leaves, not after. */
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const announced = useRef(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [messageTone, setMessageTone] = useState<"ok" | "failed" | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  /** A question is out and its answer has not landed. With results already on
   *  screen this marks the grid busy; without any it shows the skeleton. */
  const [searching, setSearching] = useState(false);
  const ticket = useRef(0);

  /** A category a body owns: no listing names it, and no source is searched. */
  const bodyKinds: Partial<Record<ListingCategory, React.ReactNode>> = {
    font: bodies["font-picker"],
    local: bodies["wallpaper-engine"],
  };

  const present = (
    category: ListingCategory,
    listing: readonly AssetSourceListing[],
  ): boolean =>
    listing.some((source) => source.category === category) ||
    bodyKinds[category] != null;

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
        return (
          listed[0]?.category ?? (bodyKinds.font != null ? "font" : "local")
        );
      });
    });
    return () => {
      live = false;
    };
    // `bodyKinds` is read for presence only; its nodes are React state the
    // effect must not restart on.
  }, [open, client, initialCategory]);

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
    if (bodyKinds[category] != null && !presentCategories.includes(category)) {
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
  const enabledKey = enabledSources.map((source) => source.id).join("|");

  useEffect(() => {
    // Any change of question discards an answer already in flight, before the
    // debounce would: a chip switched off mid-flight must not land its late page.
    ticket.current += 1;

    // Body categories draw a component, not a search; a kind whose every
    // source is switched off has no question to ask either.
    if (
      !open ||
      active === undefined ||
      visibleSources.length === 0 ||
      enabledSources.length === 0
    ) {
      setSearching(false);
      setAnswer(undefined);
      setFailures([]);
      return;
    }

    setSearching(true);
    const enabled = enabledSources.map((source) => source.id);
    const issued = ticket.current;
    const timer = setTimeout(() => {
      void searchAssets(
        {
          query,
          enabled,
          pages: Object.fromEntries(enabled.map((id) => [id, page])),
        },
        client,
      ).then((next) => {
        if (issued !== ticket.current) return;
        setSearching(false);
        setAnswer(next);
        setFailures(next.pages.filter((page) => page.failure !== undefined));
        // A page past the end is the answer's own: land on the last page it
        // does have rather than leave an empty grid under a numeral nothing
        // reaches.
        const total = totalPagesOf(next.pages);
        if (page > total) {
          setPage(total);
          return;
        }
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
        setSelected(undefined);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `enabledKey` stands for the enabled list; `enabledSources` is a new array
    // every render and would restart the timer on unrelated state.
  }, [open, active, query, enabledKey, sources.length, client, page]);

  // A source switched off after its answer left the host is dropped from the
  // grid at once, not on the next round trip.
  const enabledIds = new Set(enabledSources.map((source) => source.id));
  const rows =
    answer === undefined
      ? []
      : rowsIn(answer.pages.filter((page) => enabledIds.has(page.source)));
  const total =
    answer === undefined
      ? 1
      : totalPagesOf(
          answer.pages.filter((page) => enabledIds.has(page.source)),
        );
  // An empty page with more pages behind it is not "no results": the author is
  // looking at a slice, and the pager is how they leave it.
  const empty =
    answer !== undefined &&
    failures.length === 0 &&
    rows.length === 0 &&
    total <= 1;
  /** A kind filter can leave every one of its sources switched off. The chips
   *  are the only writer of that choice, so the panel says how to undo it
   *  rather than giving no-results advice no query could fix. */
  const kindSourcesOff =
    visibleSources.length > 0 && enabledSources.length === 0;

  /** A change of question returns to page one, at the press that made it. A
   *  success sentence answers the question that was asked, so it leaves with it. */
  const reask = (): void => {
    setPage(1);
    setSelected(undefined);
    setMessage(undefined);
    setMessageTone(undefined);
  };

  const sourceOf = (id: string): AssetSourceListing | undefined =>
    sources.find((source) => source.id === id);

  const bodyOf = (
    category: ListingCategory,
  ): AssetSourceListing["body"] | undefined =>
    sources.find((source) => source.category === category)?.body ??
    (bodyKinds[category] == null
      ? undefined
      : category === "font"
        ? "font-picker"
        : "wallpaper-engine");

  const runRow = async (
    row: Row,
    placement?: AssetPlacement,
  ): Promise<ActionOutcome> => {
    setBusy(true);
    const outcome = await onAction(row.page, row.result, placement);
    setBusy(false);
    setMessage(outcome.message);
    setMessageTone(outcome.ok ? "ok" : "failed");
    return outcome;
  };

  const runAction = async (
    placement?: AssetPlacement,
  ): Promise<ActionOutcome> =>
    selected === undefined
      ? { ok: false, message: "" }
      : runRow(selected, placement);

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

  /** A key that is missing or refused is the one reason to offer Connections:
   *  a control that cannot help is not an availability. */
  const needsConnections = failures.some(
    (page) => page.failure?.reason === "needs-credential",
  );
  const isGrid = gridSources.length > 0;

  const status = isGrid ? (
    <>
      <span data-yunari-asset-count="">
        {answer === undefined
          ? ""
          : uiCopy.assets.results(
              rows.length,
              new Set(rows.map((row) => sourceIdOf(row.result))).size,
            )}
      </span>
      {message === undefined ? null : (
        <span className="ml-[var(--space-8)]" data-yunari-asset-message="">
          {message}
        </span>
      )}
    </>
  ) : undefined;

  const placeAction: FinderAction = {
    id: "place",
    label: uiCopy.assets.placeOnCanvas,
    busyLabel: uiCopy.assets.working,
    tone: "plain",
    disabled: selected === undefined || busy,
    run: () => runAction("place"),
  };
  const mainAction: FinderAction = {
    id: "apply",
    label: uiCopy.assets.action[active],
    busyLabel: uiCopy.assets.working,
    tone: "plain",
    disabled: selected === undefined || busy,
    run: () => runAction(active === "image" ? "background" : undefined),
  };

  const cards: readonly FinderCardModel[] = rows.map(({ page, result }) =>
    cardModelOf(result, sourceOf(page.source)?.label ?? page.source),
  );
  const rowOfCard = (card: FinderCardModel): Row | undefined =>
    rows.find(
      ({ page, result }) =>
        result.id === card.id && page.source === card.sourceId,
    );

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
        setActive(category);
        // A tab is a new question, so a filter from the last tab is not an
        // answer about this one.
        setPresetFilter("all");
        reask();
      }}
      {...(isGrid
        ? {
            query,
            searchPlaceholder: uiCopy.assets.search[active],
            onQueryChange: (value: string) => {
              setQuery(value);
              reask();
            },
          }
        : {})}
      filters={
        active === "colour" && kinds.length > 1 ? (
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
              reask();
            }}
          />
        ) : undefined
      }
      sources={
        visibleSources.length > 1 ? (
          <>
            {visibleSources.map((source) => {
              const off = disabled.has(source.id);
              const failed = failures.some(
                (page) =>
                  page.source === source.id && page.failure !== undefined,
              );
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
                        enabledSources.length > 1 ||
                        !visibleSources.some((entry) => !next.has(entry.id))
                      ) {
                        next.add(source.id);
                      }
                      return next;
                    });
                    reask();
                  }}
                />
              );
            })}
          </>
        ) : undefined
      }
      tools={
        <>
          {isGrid && answer !== undefined && total > 1 ? (
            <FinderPager page={page} total={total} onPage={setPage} />
          ) : null}
          <ConnectionsButton
            needs={needsConnections}
            onOpen={() => onOpenConnections?.()}
          />
        </>
      }
      status={status}
      {...(message === undefined || messageTone === undefined
        ? {}
        : { statusTone: messageTone })}
      actions={
        isGrid ? (
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
        ) : undefined
      }
    >
      {!isGrid ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-yunari-asset-body={bodyOf(active)}
        >
          {bodyOf(active) === "font-picker"
            ? bodies["font-picker"]
            : bodyOf(active) === "wallpaper-engine"
              ? bodies["wallpaper-engine"]
              : uiCopy.assets.noSource}
        </div>
      ) : (
        <>
          {notice === undefined ? null : (
            <p className="text-xs text-muted" data-yunari-asset-host-notice="">
              {uiCopy.assets.remoteHostNotice(notice)}
            </p>
          )}

          {failures.map((page) => {
            const source = sourceOf(page.source);
            const label = source?.label ?? page.source;
            const failure = page.failure;
            if (failure === undefined) return null;

            return failure.reason === "needs-credential" ? (
              <p
                key={page.source}
                className="text-sm"
                data-yunari-asset-needs-credential={page.source}
              >
                {uiCopy.assets.needsCredential(label)}
              </p>
            ) : (
              <p
                key={page.source}
                className="text-sm"
                data-yunari-asset-failure={page.source}
              >
                {uiCopy.assets.sourceFailed(label, failure.message)}
              </p>
            );
          })}

          {kindSourcesOff ? (
            <p className="text-sm text-muted" data-yunari-asset-kind-off="">
              {uiCopy.assets.kindSourcesOff}
            </p>
          ) : answer === undefined || (empty && searching) ? (
            // Nothing to keep, or the kept answer says "nothing" and a new
            // question is out: the wait is the grid that is coming.
            <div
              data-yunari-asset-loading=""
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <FinderSkeleton />
            </div>
          ) : empty ? (
            <p
              className="flex flex-col items-start gap-[var(--space-8)] text-sm text-muted"
              data-yunari-asset-empty=""
            >
              {uiCopy.assets.noResults}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  reask();
                }}
                data-yunari-asset-clear-query=""
                className="underline"
              >
                {uiCopy.assets.clearQuery}
              </button>
            </p>
          ) : (
            <div
              data-yunari-asset-grid=""
              aria-busy={searching ? "true" : undefined}
              className="flex min-h-0 flex-1 flex-col"
            >
              <FinderGrid
                label={uiCopy.assets.category[active]}
                cards={cards}
                selectedId={
                  selected === undefined
                    ? undefined
                    : `${selected.page.source}:${selected.result.id}`
                }
                onSelect={(card) => {
                  const row = rowOfCard(card);
                  if (row !== undefined) setSelected(row);
                }}
                onPreview={() => {
                  // The preview modal lands in Task 4.2.
                }}
                onApply={(card) => {
                  const row = rowOfCard(card);
                  if (row === undefined) return;
                  setSelected(row);
                  void runRow(
                    row,
                    active === "image" ? "background" : undefined,
                  );
                }}
                onNeedMore={() => {
                  // The append path lands in Task 2.3.
                }}
                canLoadMore={false}
                appending={false}
              />
            </div>
          )}
        </>
      )}
    </FinderFrame>
  );
}
