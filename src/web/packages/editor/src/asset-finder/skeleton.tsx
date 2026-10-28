import type * as React from "react";
import { uiCopy } from "../ui-copy.js";

/** One arriving card: the 4:3 well and the two lines every card has. */
export function SkeletonCard(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-yunari-skeleton-card=""
      className="flex min-w-0 flex-col gap-[var(--space-4)]"
    >
      <span className="aspect-[4/3] w-full animate-pulse rounded-[var(--radius-md)] border border-edge bg-[var(--panel-2)] motion-reduce:animate-none" />
      <span
        data-yunari-skeleton-line=""
        className="h-3 w-5/6 animate-pulse rounded-[var(--radius-sm)] bg-[var(--panel-2)] motion-reduce:animate-none"
      />
      <span
        data-yunari-skeleton-line=""
        className="h-3 w-2/3 animate-pulse rounded-[var(--radius-sm)] bg-[var(--panel-2)] motion-reduce:animate-none"
      />
    </span>
  );
}

/** The finder's one wait: the cards that are coming, in the grid they will
 *  land in. Shapes are hidden and nothing is focusable, so a wait never steals
 *  a press; the one hidden sentence is read when the region is entered. */
export function FinderSkeleton({
  count = 12,
}: {
  readonly count?: number;
}): React.JSX.Element {
  return (
    <div
      data-yunari-skeleton-grid=""
      aria-busy="true"
      className="grid content-start grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-[var(--space-12)]"
    >
      <span className="sr-only">{uiCopy.assets.skeletonLoading}</span>
      {Array.from({ length: count }, (_, at) => (
        <SkeletonCard key={at} />
      ))}
    </div>
  );
}
