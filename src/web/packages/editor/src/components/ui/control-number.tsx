import type * as React from "react";
import { useState } from "react";
import { uiCopy } from "../../ui-copy.js";
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
 * A finite number, or nothing at all — never a zero nobody typed.
 *
 * DESIGN.md §5's validation rule belongs to the field's owner: bounds, integrality
 * and optionality are props, not a global minimum, and a rejected draft is kept
 * with its reason rather than coerced or silently clamped. Clearing an
 * authored key is a different act from writing zero, so it is a different
 * callback (`onClear`); with no callback to clear through, a blank field is
 * invalid.
 */

/** A complete number, with no exponent and no trailing garbage. The minus
 *  sign and the bare decimal point are drafts, not values. */
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parse(draft: string): number | undefined {
  if (!NUMBER.test(draft)) return undefined;
  const value = Number(draft);
  return Number.isFinite(value) ? value : undefined;
}

function format(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

export function ControlNumber(
  props: ControlProps & {
    readonly value: number | undefined;
    readonly unit?: string;
    readonly min?: number;
    readonly max?: number;
    /** The only values the owner accepts; a value between two members is
     *  refused rather than coerced to the nearest one the owner can draw. */
    readonly oneOf?: readonly number[];
    /** The owner asked for whole numbers; a fraction is refused like out-of-bounds. */
    readonly integer?: boolean;
    /**
     * A measurement, not a setting: the number is shown and nothing commits.
     * Different from `refused` in what it says — this is not a capability the
     * selection lacks, it is a value the selection does not own.
     */
    readonly readOnly?: boolean;
    /**
     * A half of a paired row: the label and the well without a row of their own,
     * so two of these can share one line. `ControlPair` is the only caller — a
     * lone number field wants its own row.
     */
    readonly inline?: boolean;
    /**
     * The element outside this control that names it, when the caller renders
     * its own label — a slider's well is 40px at the end of a row whose label
     * already sits at its head, so the inline form drops its label element and
     * takes the row's. The input is still named; only the second copy goes.
     */
    readonly labelledById?: string;
    /** The inline well's width, when it is not the row's whole value cell. */
    readonly wellClassName?: string;
    readonly onCommit: (value: number) => void;
    readonly onClear?: () => void;
  },
): React.JSX.Element {
  const {
    label,
    id,
    disabled,
    refused,
    hint,
    describedById,
    data,
    density,
    value,
    unit,
    min,
    max,
    oneOf,
    integer,
    readOnly,
    inline,
    labelledById,
    wellClassName,
    onCommit,
    onClear,
  } = props;
  const ids = useControlIds(id);
  const blocked = isBlocked({ disabled, refused });
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | undefined>(undefined);
  const shown = draft ?? format(value);

  const commit = (): void => {
    // Nothing was edited, so there is nothing to validate: a blur of a field
    // that was merely tabbed through must not accuse the author of anything.
    if (draft === null) return;
    const text = draft.trim();
    // A read-only half holds a measurement, so it keeps showing it: a draft
    // that reached it anyway — a script, a stale row — is dropped, not written.
    if (readOnly === true) {
      setDraft(null);
      setInvalid(undefined);
      return;
    }
    if (blocked) return;
    if (text === "") {
      if (onClear !== undefined) {
        setDraft(null);
        setInvalid(undefined);
        onClear();
        return;
      }
      setInvalid(uiCopy.controls.valueRequired);
      return;
    }
    const parsed = parse(text);
    if (parsed === undefined) {
      setInvalid(uiCopy.controls.notANumber);
      return;
    }
    if (integer === true && !Number.isInteger(parsed)) {
      setInvalid(uiCopy.controls.wholeNumber);
      return;
    }
    if (min !== undefined && parsed < min) {
      setInvalid(uiCopy.controls.atLeast(min));
      return;
    }
    if (max !== undefined && parsed > max) {
      setInvalid(uiCopy.controls.atMost(max));
      return;
    }
    if (oneOf !== undefined && !oneOf.includes(parsed)) {
      setInvalid(uiCopy.controls.oneOf(oneOf));
      return;
    }
    setInvalid(undefined);
    setDraft(null);
    if (parsed !== value) onCommit(parsed);
  };

  const keys = useDraftCommit({
    draft,
    setDraft,
    commit,
    // Escape drops the draft, so the refusal the draft raised is dropped too.
    reset: () => setInvalid(undefined),
  });

  const body = (
    <>
      <ControlWell
        density={density}
        blocked={blocked}
        {...(wellClassName === undefined
          ? {}
          : { widthClassName: wellClassName })}
      >
        <input
          {...data}
          id={ids.control}
          type="text"
          inputMode="decimal"
          className="h-full w-full bg-transparent text-right font-mono text-sm text-text outline-none"
          value={shown}
          readOnly={readOnly === true || refused !== undefined}
          disabled={disabled}
          aria-disabled={refused === undefined ? undefined : true}
          {...(inline === true && labelledById !== undefined
            ? { "aria-labelledby": labelledById }
            : {})}
          aria-invalid={invalid === undefined ? undefined : true}
          aria-describedby={describedBy(
            describedById,
            hint === undefined ? undefined : ids.hint,
            refused === undefined ? undefined : ids.reason,
            invalid === undefined ? undefined : ids.invalid,
          )}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(undefined);
          }}
          {...keys}
          onBlur={commit}
        />
        {unit === undefined ? null : (
          <span className="ml-[var(--space-4)] text-xs text-faint">{unit}</span>
        )}
      </ControlWell>
      {invalid === undefined ? null : (
        <ControlReason id={ids.invalid}>{invalid}</ControlReason>
      )}
    </>
  );

  if (inline === true) {
    return (
      <>
        {labelledById === undefined ? (
          <label
            id={ids.label}
            htmlFor={ids.control}
            className="text-xs text-muted"
          >
            {label}
          </label>
        ) : null}
        {body}
      </>
    );
  }

  return (
    <ControlRow
      ids={ids}
      label={label}
      labelFor={ids.control}
      refused={refused}
      hint={hint}
      density={density}
    >
      {body}
    </ControlRow>
  );
}
