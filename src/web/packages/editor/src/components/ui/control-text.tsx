import type * as React from "react";
import { useState } from "react";
import {
  type ControlProps,
  ControlReason,
  ControlRow,
  ControlWell,
  describedBy,
  isBlocked,
  useControlIds,
  useDraftCommit,
} from "./control-well.js";

/**
 * A text field that commits on Enter or blur, and never on a keystroke.
 *
 * The design's editing and recovery contract: the draft is not authored state, so
 * a publication that lands mid-edit cannot replace what is being typed, and
 * Escape restores the authored value without adding history. The keyboard
 * decision itself — the Enter/IME guard and the Escape reset — is
 * `useDraftCommit`'s, shared with the number field so the two cannot drift.
 *
 * The input is `h-full` of the well's 26px box, so its target is the design's
 * 24×24. A field cannot take the button route (`hitTargetClasses`): a replaced
 * element has no `::before` to carry the area.
 */
export function ControlText(
  props: ControlProps & {
    readonly value: string;
    /**
     * A multi-line field (a polyline's points, a path's data). The draft and
     * commit rules are the same; only the box differs — a document does not fit
     * one line, and §5's 26px well is for one-line answers.
     */
    readonly multiline?: boolean;
    readonly rows?: number;
    readonly onCommit: (value: string) => void;
  },
): React.JSX.Element {
  const {
    label,
    id,
    disabled,
    refused,
    invalid,
    density,
    data,
    value,
    multiline,
    rows,
    onCommit,
  } = props;
  const ids = useControlIds(id);
  const blocked = isBlocked({ disabled, refused });
  // `null` is not editing: the authored value is shown, and a publication moves
  // it. Any other string is the person's draft, and nothing else may replace it.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  const commit = (): void => {
    const next = draft ?? value;
    setDraft(null);
    if (blocked || next === value) return;
    onCommit(next);
  };

  const keys = useDraftCommit({ draft, setDraft, commit, multiline });

  const shared = {
    ...data,
    id: ids.control,
    value: shown,
    readOnly: refused !== undefined,
    disabled,
    "aria-disabled": refused === undefined ? undefined : true,
    "aria-invalid": invalid === undefined ? undefined : true,
    "aria-describedby": describedBy(
      refused === undefined ? undefined : ids.reason,
      invalid === undefined ? undefined : ids.invalid,
    ),
    onChange: (event: { target: { value: string } }) =>
      setDraft(event.target.value),
    ...keys,
    onBlur: commit,
  };

  return (
    <ControlRow
      ids={ids}
      label={label}
      labelFor={ids.control}
      refused={refused}
      density={density}
    >
      {multiline === true ? (
        <div className="w-full rounded-md border border-edge bg-panel-2 px-[var(--space-6)] py-[var(--space-4)] focus-within:outline focus-within:outline-2 focus-within:outline-accent">
          <textarea
            {...shared}
            rows={rows ?? 5}
            className="w-full resize-y bg-transparent font-mono text-sm text-text outline-none"
          />
        </div>
      ) : (
        <ControlWell density={density} blocked={blocked}>
          <input
            {...shared}
            type="text"
            className="h-full w-full bg-transparent text-sm text-text outline-none"
          />
        </ControlWell>
      )}
      {invalid === undefined ? null : (
        <ControlReason id={ids.invalid}>{invalid}</ControlReason>
      )}
    </ControlRow>
  );
}
