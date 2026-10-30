import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { uiCopy } from "../ui-copy.js";
import { FinderCard, type FinderCardModel } from "./finder-card.js";
import { SkeletonCard } from "./skeleton.js";

/** Where a key moves the roving focus: one step, one row, or either end,
 *  clamped so the grid never loses it. A key the grid does not use leaves the
 *  focus where it was (R2). */
export function moveInGrid(
  key: string,
  at: number,
  columns: number,
  length: number,
): number {
  if (length <= 0) return at;
  const last = length - 1;
  const row = Math.max(1, columns);
  switch (key) {
    case "ArrowRight":
      return Math.min(last, at + 1);
    case "ArrowLeft":
      return Math.max(0, at - 1);
    case "ArrowDown":
      return Math.min(last, at + row);
    case "ArrowUp":
      return Math.max(0, at - row);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return at;
  }
}

/**
 * The finder's one grid: one listbox, one tab stop, arrow-key movement that
 * follows the column count, Enter on the focused card, and a sentinel that
 * asks for the next page before the reader reaches the bottom.
 *
 * The scroller is the observer's root, not the viewport: the finder's body is
 * the only thing that scrolls, so a viewport root would never fire.
 */
export function FinderGrid(props: {
  readonly label: string;
  readonly cards: readonly FinderCardModel[];
  readonly selectedId: string | undefined;
  readonly busyId?: string;
  readonly failedId?: string;
  /** Every card whose write already succeeded: a tab may complete several. */
  readonly doneIds?: ReadonlySet<string>;
  readonly onSelect: (card: FinderCardModel) => void;
  readonly onPreview: (card: FinderCardModel) => void;
  readonly onApply: (card: FinderCardModel) => void;
  readonly onNeedMore: () => void;
  readonly canLoadMore: boolean;
  readonly appending: boolean;
}): React.JSX.Element {
  const [focusAt, setFocusAt] = useState(0);
  const [columns, setColumns] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<number, HTMLButtonElement | null>());
  const shouldFocus = useRef(false);
  const needMore = useRef(props.onNeedMore);
  needMore.current = props.onNeedMore;

  const at = Math.min(focusAt, Math.max(0, props.cards.length - 1));

  useEffect(() => {
    const node = grid.current;
    if (node === null) return undefined;
    const read = (): void => {
      const reported = getComputedStyle(node).gridTemplateColumns;
      const count = reported.split(" ").filter((part) => part !== "").length;
      setColumns(count < 1 ? 1 : count);
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!shouldFocus.current) return;
    const node = nodes.current.get(at);
    if (node == null) return;
    shouldFocus.current = false;
    node.focus();
    // jsdom has no layout to scroll; a real browser reveals the card.
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [at]);

  useEffect(() => {
    if (!props.canLoadMore) return undefined;
    const node = sentinel.current;
    if (node === null || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          needMore.current();
        }
      },
      // Half a viewport early: the next page is in flight before the reader
      // reaches the last row, without fetching every page on open.
      { root: scroller.current, rootMargin: "0px 0px 50% 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [props.canLoadMore]);

  const onKeyDown = (index: number) => (event: React.KeyboardEvent) => {
    const card = props.cards[index];
    if (card === undefined) return;
    if (event.key === "Enter") {
      event.preventDefault();
      props.onApply(card);
      return;
    }
    const next = moveInGrid(event.key, index, columns, props.cards.length);
    if (next === index) return;
    event.preventDefault();
    shouldFocus.current = true;
    setFocusAt(next);
  };

  // The right pad is the gap between the last column and the scrollbar: the
  // cards must not sit against the thumb.
  return (
    <>
      {props.appending ? (
        // The appended skeleton cards are hidden, so this is what announces
        // the wait. Outside the listbox: its children must be options.
        <span role="status" className="sr-only">
          {uiCopy.assets.skeletonLoading}
        </span>
      ) : null}
      <div
        ref={scroller}
        role="listbox"
        aria-label={props.label}
        aria-busy={props.appending ? true : undefined}
        data-yunari-finder-grid=""
        className="min-h-0 flex-1 overflow-y-auto pr-[var(--space-8)]"
      >
        <div
          ref={grid}
          className="grid content-start grid-cols-[repeat(auto-fill,minmax(var(--finder-card-min-width),1fr))] gap-[var(--space-12)]"
        >
          {props.cards.map((card, index) => (
            <FinderCard
              // Two sources can name the same id; the pair is the identity.
              key={`${card.sourceId}:${card.id}`}
              model={card}
              selected={`${card.sourceId}:${card.id}` === props.selectedId}
              busy={card.id === props.busyId}
              failed={card.id === props.failedId}
              done={props.doneIds?.has(card.id) ?? false}
              tabStop={index === at}
              focus={(node) => {
                nodes.current.set(index, node);
              }}
              onSelect={() => props.onSelect(card)}
              onPreview={() => props.onPreview(card)}
              onKeyDown={onKeyDown(index)}
            />
          ))}
          {props.appending
            ? Array.from({ length: 4 }, (_, index) => (
                <SkeletonCard key={`skeleton-${index}`} />
              ))
            : null}
        </div>
        <div ref={sentinel} aria-hidden="true" />
      </div>
    </>
  );
}
