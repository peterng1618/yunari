import type { AssetResult } from "@yunari/renderer-core";
import type * as React from "react";
import { useRef, useState } from "react";
import { uiCopy } from "../ui-copy.js";

/** The grid's own geometry: a result's column position is what makes Down and
 *  Up mean something, so the count lives here rather than in a class alone. */
const COLUMNS = 4;

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

/** One tile: a trio names its three families and a family names itself, with
 *  the provider badge every mixed grid carries. */
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
      className={`relative flex min-h-[112px] min-w-0 flex-col items-center justify-center gap-[var(--space-4)] rounded-[var(--radius-md)] border bg-[var(--panel-2)] p-[var(--space-10)] text-center ${
        selected ? "border-accent ring-1 ring-accent" : "border-edge"
      }`}
    >
      <span
        data-yunari-font-provider={source}
        className="absolute right-[var(--space-4)] top-[var(--space-4)] rounded-[var(--radius-sm)] border border-edge px-[var(--space-4)] text-[8px] text-faint"
      >
        {providers[source] ?? source}
      </span>
      {/* A specimen paper, not the family's own face: the editor never reads
          font bytes, and loading them is the preview panel's job (Task 11). */}
      <span aria-hidden="true" className="text-[27px] leading-none">
        Aa
      </span>
      <span className="max-w-full truncate text-xs font-medium">
        {trio === undefined ? result.name : trioFamilies(result)}
      </span>
      <span className="max-w-full truncate text-[10px] text-faint">
        {trio === undefined
          ? `${uiCopy.assets.fontFamilyMeta(cuts)} · ${result.licence}`
          : `${uiCopy.assets.fontTrioMeta(cuts)} · ${ROLES.filter((role) => trio.roles[role] !== undefined).join(" · ")}`}
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
  const [focusAt, setFocusAt] = useState(0);
  const selectedAt = results.findIndex((result) => result.id === selectedId);
  const tabStop =
    selectedAt >= 0 ? selectedAt : Math.min(focusAt, results.length - 1);

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
    setFocusAt(target);
    tiles.current[target]?.focus();
  };

  return (
    <div className="flex min-h-0 flex-col gap-[var(--space-8)]">
      <div
        role="listbox"
        aria-label={uiCopy.assets.fontResults}
        data-yunari-font-grid=""
        className="grid min-h-0 flex-1 content-start grid-cols-4 gap-[var(--space-8)] overflow-y-auto"
      >
        {results.map((result, at) => (
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
        ))}
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
