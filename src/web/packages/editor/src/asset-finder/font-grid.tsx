import type { AssetResult, FontCut } from "@yunari/renderer-core";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uiCopy } from "../ui-copy.js";
import { faceStyle, useSpecimens } from "./font-preview-panel.js";
import { SourceMark } from "./source-mark.js";

/** The grid's own geometry: a result's column position is what makes Down and
 *  Up mean something, so the count lives here rather than in a class alone. */
const COLUMNS = 4;

/** One row's own height, matching the `--font-tile-min-height` token (112px),
 *  and the gap below it, `--space-8`. Absolute row placement reads this JS
 *  constant, so changing the token alone desynchronises the tiles from their
 *  rows; the two must move together. A rem-based class would drift the moment
 *  the shell's root font-size is not 16px, and the window would land between
 *  two rows. */
const ROW_HEIGHT = 152;
const ROW_GAP = 8;
const ROW_PITCH = ROW_HEIGHT + ROW_GAP;

/** Rows mounted at once. 379 results is 95 rows, so this is 60 tiles rather
 *  than 379; the rest are placed only when the scroll or the focus reaches
 *  them. */
const WINDOW_ROWS = 15;

/** The trio's roles in the order the tile names them, not the map's insertion
 *  order: a source that omits a role still reads heading, body, mono. */
const ROLES = ["heading", "body", "mono"] as const;

/** A result id is `<source>:<entry id>` (the host prefixes it once). */
function sourceIdOf(result: AssetResult): string {
  const at = result.id.indexOf(":");
  return at === -1 ? result.id : result.id.slice(0, at);
}

function trioFamilies(result: AssetResult): string {
  const roles = result.font?.trio?.roles;
  if (roles === undefined) return result.name;
  return ROLES.flatMap((role) => {
    const family = roles[role]?.family;
    return family === undefined ? [] : [family];
  }).join(" · ");
}

/** The specimen sizes a trio's three roles are drawn at: heading largest,
 *  mono smallest, so the thumbnail reads as the hierarchy the trio makes. */
const SPECIMEN_SIZE: Readonly<Record<(typeof ROLES)[number], number>> = {
  heading: 20,
  body: 15,
  mono: 12,
};

/** The cuts a card draws: a trio's three role faces in reading order, or the
 *  family's first cut. Identity is memoised on the result, because the
 *  specimen loader re-registers its faces whenever the list changes. */
function specimenCuts(result: AssetResult): readonly FontCut[] {
  const roles = result.font?.trio?.roles;
  if (roles === undefined) {
    const first = result.font?.cuts[0];
    return first === undefined ? [] : [first];
  }
  return ROLES.flatMap((role) => {
    const cut = roles[role];
    return cut === undefined ? [] : [cut];
  });
}

/** One card: the faces drawn in their own type, the result's name, and the
 *  source that supplied it — the shape every other finder tab's grid uses. */
function FontTile({
  result,
  selected,
  tabStop,
  focus,
  providers,
  onSelect,
  onKeyDown,
}: {
  readonly result: AssetResult;
  readonly selected: boolean;
  readonly tabStop: boolean;
  readonly focus: (node: HTMLButtonElement | null) => void;
  readonly providers: Readonly<Record<string, string>>;
  readonly onSelect: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}): React.JSX.Element {
  const source = sourceIdOf(result);
  const trio = result.font?.trio;
  const cuts = result.font?.cuts.length ?? 0;
  // A trio is one role family each; `cuts` can carry every weight variant, so
  // it is not a family count.
  const families = ROLES.filter(
    (role) => trio?.roles[role] !== undefined,
  ).length;
  const specimen = useMemo(() => specimenCuts(result), [result]);
  useSpecimens(specimen);
  return (
    <button
      ref={focus}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      data-yunari-font-tile={result.id}
      data-yunari-font-kind={trio === undefined ? "family" : "trio"}
      data-selected={selected ? "" : undefined}
      className={`flex min-h-[var(--font-tile-min-height)] min-w-0 flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border bg-[var(--panel-2)] p-[var(--space-8)] text-left ${
        selected ? "border-accent ring-1 ring-accent" : "border-edge"
      }`}
    >
      {/* The provider's own specimen bytes, held while the card is mounted:
          the editor reads no font bytes of its own, and a failed load leaves
          the row on the fallback family rather than blanking the card. */}
      <span
        aria-hidden="true"
        data-yunari-font-specimen=""
        className="flex h-24 w-full flex-col items-center justify-center gap-[var(--space-4)] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg)]"
      >
        {specimen.map((cut, at) => (
          <span
            key={cut.id}
            style={{
              ...faceStyle(cut),
              fontSize: SPECIMEN_SIZE[ROLES[at] ?? "body"],
            }}
            className="max-w-full truncate leading-none"
          >
            {cut.family}
          </span>
        ))}
      </span>
      <span className="flex w-full min-w-0 items-center gap-[var(--space-6)]">
        <span className="truncate text-xs font-medium">
          {trio === undefined ? result.name : trioFamilies(result)}
        </span>
        <span className="ml-auto flex-none">
          <SourceMark id={source} label={providers[source] ?? source} />
        </span>
      </span>
      <span className="max-w-full truncate text-[10px] text-faint">
        {trio === undefined
          ? `${uiCopy.assets.fontFamilyMeta(cuts)} · ${result.licence}`
          : `${uiCopy.assets.fontTrioMeta(families)} · ${ROLES.filter((role) => trio.roles[role] !== undefined).join(" · ")}`}
      </span>
    </button>
  );
}

/**
 * The Fonts body's result grid: trios and families in one four-column list.
 *
 * It owns the tiles, the selection's accessible shape and roving focus. It
 * draws what it is handed and reports a press; the body above owns the
 * question and the session owns every write.
 */
export function FontGrid({
  results,
  selectedId,
  onSelect,
  onLoadMore,
  providers = {},
}: {
  readonly results: readonly AssetResult[];
  readonly selectedId: string | undefined;
  readonly onSelect: (result: AssetResult) => void;
  /** Absent when no source has another page. */
  readonly onLoadMore?: () => void;
  /** Each source's own label, keyed by the id the host prefixes its rows with. */
  readonly providers?: Readonly<Record<string, string>>;
}): React.JSX.Element {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusAt, setFocusAt] = useState(0);
  const [start, setStart] = useState(0);
  /** Set when a key press needs the tile focused after the window has moved;
   *  the tile it names is not in the DOM until the next render. */
  const pendingFocus = useRef(false);

  const rowCount = Math.ceil(results.length / COLUMNS);
  /** Clamped so a search that shortens the list cannot leave the window past
   *  its end — the container resets `scrollTop` on its own, but `start` is
   *  state and would not. */
  const firstRow = Math.min(
    Math.max(0, start),
    Math.max(0, rowCount - WINDOW_ROWS),
  );

  const selectedAt = results.findIndex((result) => result.id === selectedId);
  const preferred =
    selectedAt >= 0 ? selectedAt : Math.min(focusAt, results.length - 1);
  const windowStart = firstRow * COLUMNS;
  const windowEnd = Math.min(
    results.length,
    windowStart + WINDOW_ROWS * COLUMNS,
  );
  // Exactly one mounted tile is the tab stop. The preferred one can be outside
  // the window (a filter changed under a scrolled list), so the first visible
  // tile stands in rather than leaving the listbox with no stop at all.
  const tabStop =
    preferred >= windowStart && preferred < windowEnd ? preferred : windowStart;

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) return;
    // Re-mounting the window on every pixel of scroll is the thing
    // virtualisation exists to avoid, so a row's worth of movement is the
    // threshold rather than one pixel.
    const next = Math.floor(element.scrollTop / ROW_PITCH);
    setStart((current) => (Math.abs(current - next) > 4 ? next : current));
  }, []);

  /** Puts `at`'s row in the window, moving the scroll with it so the next
   *  scroll event does not immediately put the window back. */
  const reveal = (at: number): void => {
    const row = Math.floor(at / COLUMNS);
    if (row >= firstRow && row < firstRow + WINDOW_ROWS) return;
    const lastStart = Math.max(0, rowCount - WINDOW_ROWS);
    const next = Math.min(
      lastStart,
      Math.max(0, row - Math.floor(WINDOW_ROWS / 2)),
    );
    setStart(next);
    if (scrollRef.current !== null) {
      scrollRef.current.scrollTop = next * ROW_PITCH;
    }
  };

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    tiles.current[focusAt]?.focus();
  }, [focusAt, firstRow]);

  const moveFocus = (
    event: React.KeyboardEvent<HTMLElement>,
    at: number,
  ): void => {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = at + 1;
        break;
      case "ArrowLeft":
        next = at - 1;
        break;
      case "ArrowDown":
        next = at + COLUMNS;
        break;
      case "ArrowUp":
        next = at - COLUMNS;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = results.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = Math.min(results.length - 1, Math.max(0, next));
    // A key that cannot move (Left/Home at the start, Right/End at the end)
    // must not leave a focus request armed for the next window change.
    if (target === at) return;
    setFocusAt(target);
    reveal(target);
    pendingFocus.current = true;
  };

  const visibleRows = Array.from(
    { length: Math.min(WINDOW_ROWS, rowCount - firstRow) },
    (_, offset) => firstRow + offset,
  );

  return (
    <div className="flex min-h-0 flex-col gap-[var(--space-8)]">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="listbox"
        aria-label={uiCopy.assets.fontResults}
        data-yunari-font-grid=""
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <div
          role="presentation"
          data-yunari-font-grid-spacer=""
          className="relative"
          style={{ height: rowCount * ROW_PITCH }}
        >
          {visibleRows.map((row) => (
            <div
              key={row}
              role="presentation"
              data-yunari-font-grid-row=""
              className="grid grid-cols-4 gap-[var(--space-8)]"
              style={{
                position: "absolute",
                top: row * ROW_PITCH,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
              }}
            >
              {results
                .slice(row * COLUMNS, row * COLUMNS + COLUMNS)
                .map((result, column) => {
                  const at = row * COLUMNS + column;
                  return (
                    <FontTile
                      key={result.id}
                      result={result}
                      selected={result.id === selectedId}
                      tabStop={at === tabStop}
                      focus={(node) => {
                        tiles.current[at] = node;
                      }}
                      providers={providers}
                      onSelect={() => {
                        setFocusAt(at);
                        onSelect(result);
                      }}
                      onKeyDown={(event) => {
                        moveFocus(event, at);
                      }}
                    />
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      {onLoadMore === undefined ? null : (
        <button
          type="button"
          onClick={onLoadMore}
          data-yunari-font-load-more=""
          className="self-center rounded-[var(--radius-sm)] border border-edge px-[var(--space-16)] py-[var(--space-6)] text-sm text-muted"
        >
          {uiCopy.assets.fontLoadMore}
        </button>
      )}
    </div>
  );
}
