import type * as React from "react";

/**
 * One section of the Host mode: the eyebrow, the sentence that says what it is,
 * and the rows. Not `InspectorSection` — that one is a disclosure whose header
 * is a button, and none of these sections collapses.
 *
 * The hint is optional because a section whose sentence belongs to its controls
 * draws it in the body, so a body with nothing to control cannot say it.
 */
export function Group(props: {
  readonly name: string;
  readonly hint?: string | undefined;
  readonly testId: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      data-yunari-host-section={props.testId}
      className="flex flex-col gap-[var(--space-8)]"
    >
      <h2 className="m-0 text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
        {props.name}
      </h2>
      {props.hint === undefined ? null : (
        <p className="text-xs text-muted">{props.hint}</p>
      )}
      <div className="flex flex-col gap-[var(--space-6)]">{props.children}</div>
    </section>
  );
}
