import type * as React from "react";

/** The finder's one way of saying something is not a grid: a centred sentence
 *  and, when there is a way forward, one underlined action. */
export function FinderState(props: {
  readonly message: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}): React.JSX.Element {
  return (
    <div
      data-yunari-asset-state=""
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[var(--space-8)] p-[var(--space-24)] text-sm text-muted"
    >
      <p className="m-0">{props.message}</p>
      {props.action === undefined ? null : (
        <button
          type="button"
          data-yunari-asset-state-action=""
          onClick={props.action.onClick}
          className="underline"
        >
          {props.action.label}
        </button>
      )}
    </div>
  );
}
