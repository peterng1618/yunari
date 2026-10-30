import { uiCopy } from "../../ui-copy.js";

interface NumberFieldOptions {
  readonly label: string;
  readonly value: number;
  readonly data: string;
  /** A dataset value, for a keyed selector like `data-yunari-geometry="left"`.
      Absent means the bare attribute the panels already query. */
  readonly dataValue?: string;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  readonly invalidMessage?: string;
  /** Runs when an edit is refused, for a caller that also reports it elsewhere. */
  readonly onReject?: () => void;
  readonly onCommit: (value: number) => void;
}

interface NumberField {
  readonly row: HTMLElement;
  readonly input: HTMLInputElement;
  setValue(value: number): void;
  /** Refuses an edit the field itself accepted, for a caller that only finds
      out afterwards — a bound the primitive does not know. `restoreTo` is the
      value the caller knows to be authoritative; without it the last value this
      field field accepted is used. Same alert line, same rollback, so one field
      never has two kinds of invalid-input feedback. */
  refuse(restoreTo?: number): void;
}

/** The bare input, its label and its error line. `host` is the row the error
    line is appended to: only the row factory knows how the row is laid out. */
interface NumberInputOptions extends NumberFieldOptions {
  readonly host: HTMLElement;
  /** The row factory has a cell for a coarse control and asks for one. A
      paired row is a flex line two fields share, and a range dropped into it
      would land after the second field, so the paired caller does not ask. */
  readonly withRange?: boolean;
}

interface NumberInput {
  readonly label: HTMLLabelElement;
  readonly input: HTMLInputElement;
  /** The coarse control for the same value, absent unless the row asked for it
      and the field is bounded at both ends. */
  readonly range?: HTMLInputElement;
  setValue(value: number): void;
  refuse(): void;
}

let fieldSeq = 0;

export function numberField(options: NumberFieldOptions): NumberField {
  const row = document.createElement("div");
  row.className = "yunari-field";
  const field = numberInput({ ...options, host: row, withRange: true });
  row.append(field.label, field.input);
  if (field.range !== undefined)
    row.append(field.range, boundLine(options.min, options.max));
  return {
    row,
    input: field.input,
    setValue: field.setValue,
    refuse: field.refuse,
  };
}

/** The bound the field will not cross, in the field's own row. Not an alert: an
    alert claims the value was not applied when it was, and it only arrives
    after the failure the bound is here to prevent. */
function boundLine(
  min: number | undefined,
  max: number | undefined,
): HTMLElement {
  const line = document.createElement("p");
  line.className = "yunari-field-bound";
  line.textContent = `${min}–${max}`;
  return line;
}

/** Validated numeric input: it parses, lands an out-of-range value on the bound
    it crossed instead of reverting it, and owns the rollback for the values it
    refuses by restoring the last value it accepted. `numberField` wraps it in a
    labelled row, and the caller passes the row the error line belongs to. */
function numberInput(options: NumberInputOptions): NumberInput {
  let last = options.value;
  const invalidMessage = options.invalidMessage ?? uiCopy.panels.invalidNumber;
  const label = document.createElement("label");
  label.textContent = options.label;
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(options.step ?? 1);
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  input.className = "yunari-numeric";
  input.dataset[options.data] = options.dataValue ?? "";
  const id = `yunari-number-${++fieldSeq}`;
  label.htmlFor = input.id = id;
  label.id = `${id}-label`;
  input.value = String(last);
  const alert = document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.textContent = invalidMessage;

  // A range bounded at one end implies a bound at the other that the field does
  // not have, so it belongs only to the fields with both.
  const range =
    options.withRange === true &&
    options.min !== undefined &&
    options.max !== undefined
      ? rangeControl(
          options.min,
          options.max,
          options.step ?? 1,
          last,
          label.id,
          input.id,
        )
      : undefined;

  /** The one writer of the box and the slider, so they cannot disagree about
      what the value is. */
  const show = (value: number): void => {
    last = value;
    input.value = String(value);
    if (range !== undefined) range.value = String(value);
  };

  // `change`, never per keystroke: a half-typed `1` of `1000` is not an edit.
  const refuse = (restoreTo = last, reason = invalidMessage): void => {
    show(restoreTo);
    alert.textContent = reason;
    if (alert.parentElement === null) options.host.append(alert);
    options.onReject?.();
  };

  /** One accept path for both controls, so the slider cannot commit a value the
      box would have refused. */
  const accept = (raw: string): void => {
    // `Number("")` is 0, so an empty field is refused rather than coerced, and
    // a non-integer is refused rather than rounded: both are a different
    // mistake from a value that is merely too big, and the field still has to
    // tell them apart. `Number.isInteger` also rejects `NaN` and `Infinity`.
    // One vocabulary with the inspector's own controls: the reason names what
    // was wrong rather than saying only that something was.
    const next = raw === "" ? Number.NaN : Number(raw);
    if (!Number.isInteger(next)) {
      refuse(
        last,
        raw.trim() === ""
          ? uiCopy.controls.valueRequired
          : Number.isFinite(next)
            ? uiCopy.controls.wholeNumber
            : uiCopy.controls.notANumber,
      );
      return;
    }
    // Landing on the bound teaches it; reverting to the old value hides it.
    show(
      options.min !== undefined && next < options.min
        ? options.min
        : options.max !== undefined && next > options.max
          ? options.max
          : next,
    );
    alert.remove();
    options.onCommit(last);
  };

  input.addEventListener("change", () => {
    accept(input.value.trim());
  });
  range?.addEventListener("change", () => {
    // `change`, not `input`: a drag fires continuously, and a history entry per
    // pixel of travel is not one edit.
    accept(range.value);
  });

  return {
    label,
    input,
    ...(range === undefined ? {} : { range }),
    setValue: show,
    refuse,
  };
}

/** The platform's own range control, named by the label the box already has
    rather than by a second string, and styled by the row's grid rather than
    here. The id is the box's, suffixed, so it is a handle on the same field
    rather than a second unaddressable control beside it. */
function rangeControl(
  min: number,
  max: number,
  step: number,
  value: number,
  labelId: string,
  id: string,
): HTMLInputElement {
  const range = document.createElement("input");
  range.type = "range";
  range.id = `${id}-range`;
  range.className = "yunari-numeric";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  range.setAttribute("aria-labelledby", labelId);
  return range;
}
