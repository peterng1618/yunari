import type * as React from "react";
import { uiCopy } from "../ui-copy.js";

/** The finder's shared first-load placeholder.
 *
 * A grid body and a text body wait differently: the grid draws the cards that
 * are coming, the list draws rows. Both announce one sentence to a screen
 * reader, hide the shapes themselves, and take no focus, so a wait never steals
 * a press. */
export function CardGridSkeleton({
  count = 12,
}: {
  readonly count?: number;
}): React.JSX.Element {
  return (
    <div
      data-yunari-skeleton-grid=""
      aria-busy="true"
      className="grid content-start grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-[var(--space-8)]"
    >
      <span className="sr-only">{uiCopy.assets.skeletonLoading}</span>
      {Array.from({ length: count }, (_, at) => (
        <span
          // The slot is the identity: a placeholder is not a result.
          key={at}
          aria-hidden="true"
          data-yunari-skeleton-card=""
          className="block aspect-[4/3] animate-pulse rounded-[var(--radius-md)] border border-edge bg-[var(--panel-2)] motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

const LINE_WIDTHS = ["w-full", "w-5/6", "w-2/3"] as const;

export function TextSkeleton({
  lines = 3,
}: {
  readonly lines?: number;
}): React.JSX.Element {
  return (
    <div
      data-yunari-skeleton-text=""
      aria-busy="true"
      className="flex flex-col gap-[var(--space-8)]"
    >
      <span className="sr-only">{uiCopy.assets.skeletonLoading}</span>
      {Array.from({ length: lines }, (_, at) => (
        <span
          key={at}
          aria-hidden="true"
          data-yunari-skeleton-line=""
          className={`h-3 animate-pulse rounded-[var(--radius-sm)] bg-[var(--panel-2)] motion-reduce:animate-none ${
            LINE_WIDTHS[at % LINE_WIDTHS.length] ?? "w-full"
          }`}
        />
      ))}
    </div>
  );
}
