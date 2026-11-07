import type * as React from "react";
import type { HeldUpdate } from "./held-update.js";
import { ACTION_BUTTON } from "./ui/dialog.js";

export interface HeldUpdateNoticeProps {
  readonly held: HeldUpdate;
  readonly heading: string;
  readonly reasonsLabel: string;
  readonly approveLabel: string;
  /** Absent leaves the notice standing until the next press replaces it. */
  readonly dismissLabel?: string;
  readonly disabled?: boolean;
  readonly onApprove: () => void;
  readonly onDismiss?: () => void;
}

/**
 * The one review notice both install surfaces draw: a local package and a
 * catalogue item answer a held update with the same facts, so they answer with
 * the same control. The plugin's key, name and publisher are text, never
 * markup; every reason is the update policy's own word.
 */
export function HeldUpdateNotice(
  props: HeldUpdateNoticeProps,
): React.JSX.Element {
  const { held } = props;
  return (
    <div
      data-yunari-held-update=""
      role="group"
      aria-label={props.heading}
      className="flex flex-col gap-[var(--space-8)] rounded-md border border-warn bg-panel-2 p-[var(--space-12)]"
    >
      <p className="m-0 text-sm font-semibold text-text">{props.heading}</p>
      <p className="m-0 text-xs text-muted">
        {held.name} · {held.key} · {held.publisher}
      </p>
      <p className="m-0 text-xs text-muted">{props.reasonsLabel}</p>
      <ul className="m-0 flex flex-col gap-[var(--space-4)] pl-[var(--space-16)] text-xs text-muted">
        {held.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-[var(--space-8)]">
        <button
          type="button"
          data-yunari-held-approve=""
          disabled={props.disabled === true}
          className={ACTION_BUTTON}
          onClick={props.onApprove}
        >
          {props.approveLabel}
        </button>
        {props.dismissLabel === undefined ||
        props.onDismiss === undefined ? null : (
          <button
            type="button"
            data-yunari-held-dismiss=""
            disabled={props.disabled === true}
            className={ACTION_BUTTON}
            onClick={props.onDismiss}
          >
            {props.dismissLabel}
          </button>
        )}
      </div>
    </div>
  );
}
