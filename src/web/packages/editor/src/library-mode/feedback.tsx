import type * as React from "react";
import { uiCopy } from "../ui-copy.js";

/** One of the empty sentences, as a centred pair of lines at the spacing
 *  scale's empty-state breathing room. */
export function Empty(props: {
  readonly lead: string;
  readonly hint: string | undefined;
}): React.JSX.Element {
  return (
    <div
      data-yunari-store-empty=""
      className="flex flex-1 flex-col items-center justify-center gap-[var(--space-8)] px-[var(--space-32)] text-center"
    >
      <p className="text-sm text-muted">{props.lead}</p>
      {props.hint === undefined ? null : (
        <p className="text-xs text-faint">{props.hint}</p>
      )}
    </div>
  );
}

/** The failure a read that did not arrive draws: the half's own sentence and
 *  the one way forward, the same read again. It is deliberately not the
 *  `Empty` component — a failure is not one of the empties, and a data
 *  attribute that named it one would let a reader mistake the two. */
export function Failure(props: {
  readonly message: string;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div
      data-yunari-store-failure=""
      className="flex flex-1 flex-col items-center justify-center gap-[var(--space-8)] px-[var(--space-32)] text-center"
    >
      <p className="text-sm text-muted">{props.message}</p>
      <button
        type="button"
        data-yunari-store-retry=""
        onClick={props.onRetry}
        className="text-xs text-accent underline hover:text-text"
      >
        {uiCopy.store.retry}
      </button>
    </div>
  );
}
