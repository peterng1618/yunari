import {
  readSetting,
  type SettingsFieldDescriptor,
} from "@yunari/renderer-core";
import { uiCopy } from "../../ui-copy.js";
import { numberField } from "./number-field.js";
import { tooltip } from "./tooltip.js";

/**
 * One chart-setting descriptor, one control.
 *
 * `chart-manager/panel.ts` built its own label + input + select loop, and it was
 * the only surface that rendered a `SettingsFieldDescriptor`. The inspector's
 * per-kind column mounts that same rendering, so the loop is this control rather
 * than a second copy of it — and the `hint` the loop ignored reaches the author
 * here.
 *
 * It builds DOM and nothing else. The caller owns the settings object: it reads
 * this field's value out with `readSetting` and commits back through
 * `writeSetting` or `removeSetting`, which is also what keeps `path` and
 * `visibleWhen` out of this file.
 */

interface SettingsFieldOptions {
  /** The value at the descriptor's path, or `undefined` when none is authored. */
  readonly value: unknown;
  /**
   * The next value for that path. **`undefined` means remove the setting**, the
   * absent state the descriptors that carry `optional` promise — so the caller
   * deletes the key rather than writing an explicit `undefined`, which
   * `exactOptionalPropertyTypes` refuses and a reader mistakes for authored.
   */
  readonly onChange: (next: unknown) => void;
  /** Why this field refuses an edit. Renders `aria-disabled` and a tooltip. */
  readonly disabledReason?: string;
}

/**
 * Whether the descriptor is a question in this state at all.
 *
 * A `visibleWhen` that does not match is not a disabled field — a no is not the
 * same answer as a refusal — so the caller renders nothing for it. Read here
 * rather than by every caller so one rule decides it.
 */
export function isSettingVisible(
  descriptor: SettingsFieldDescriptor,
  settings: unknown,
): boolean {
  const condition = descriptor.visibleWhen;
  if (condition === undefined) return true;

  const value = readSetting(settings, condition.path);
  if ("equals" in condition) return value === condition.equals;

  // An absent setting is not the state the question is about — a chart with no
  // authored divisor draws continuously, which is what `100` already means, so
  // asking about the segmented state would offer a choice that draws nothing.
  // The state is stringified because `segmentDivisor` is a number while the
  // condition is written as the value's own name.
  return value !== undefined && String(value) !== condition.notEquals;
}

export function settingsField(
  descriptor: SettingsFieldDescriptor,
  options: SettingsFieldOptions,
): HTMLElement {
  // Keyed by the setting itself, as the panel keyed it before this control
  // existed, so the specs, the screenshots and `rebuild-driver` keep addressing
  // the same controls. A nested setting's `property` is its dotted path, so its
  // id carries the dots too.
  const id = `yunari-chart-setting-${descriptor.property}`;
  const disabled = options.disabledReason !== undefined;
  const parts =
    descriptor.kind === "number"
      ? numberParts(descriptor, options, id, disabled)
      : descriptor.kind === "boolean"
        ? checkParts(descriptor, options, id, disabled)
        : selectParts(descriptor, options, id, disabled);

  const described = [describe(parts.row, `${id}-hint`, descriptor.hint)];

  if (options.disabledReason !== undefined) {
    // The reason is a description as well as a tooltip: the tooltip is the
    // pointer's, and an author who never points at the field still has to be
    // told why it refuses — the same disclosure-for-the-mouse-only defect
    // `glass.ts` writes out at length.
    described.push(describe(parts.row, `${id}-reason`, options.disabledReason));
  }

  parts.control.setAttribute("aria-describedby", described.join(" "));

  if (disabled) {
    // `aria-disabled`, not `disabled`: a disabled control is out of the tab
    // order, so neither the reason below nor the hint reaches a keyboard.
    parts.control.setAttribute("aria-disabled", "true");
  }

  armReasonTooltip(parts.row, options.disabledReason ?? descriptor.hint);

  return parts.row;
}

interface FieldParts {
  readonly row: HTMLElement;
  readonly control: HTMLInputElement | HTMLSelectElement;
}

function numberParts(
  descriptor: SettingsFieldDescriptor,
  options: SettingsFieldOptions,
  id: string,
  disabled: boolean,
): FieldParts {
  const authored = options.value;
  const present = typeof authored === "number" && Number.isFinite(authored);
  // The value the field falls back to when it refuses an edit. An absent
  // setting shows an empty box below, so this is a floor for the rollback, not
  // a value the document is given.
  const initial = present ? authored : (descriptor.min ?? 0);

  const field = numberField({
    label: descriptor.label,
    value: initial,
    data: "yunariChartSetting",
    dataValue: descriptor.property,
    ...(descriptor.step === undefined ? {} : { step: descriptor.step }),
    ...(descriptor.min === undefined ? {} : { min: descriptor.min }),
    ...(descriptor.max === undefined ? {} : { max: descriptor.max }),
    onCommit: (next) => {
      if (disabled) {
        field.setValue(initial);
        return;
      }
      options.onChange(next);
    },
  });
  const label = field.row.querySelector("label");
  if (label !== null) label.htmlFor = field.input.id = id;

  // `numberField` offers a coarse slider on a field bounded at both ends. A
  // chart setting is a typed number — an axis bound, an angle, a percentage —
  // and a second control per bounded row is not what this surface is: the box,
  // and the bound line the row states beside it, are. The slider is named by
  // `aria-labelledby` rather than by a label of its own, which is also what the
  // panel's own "every control has a label with words on it" test refuses.
  field.row.querySelector("input[type=range]")?.remove();

  // An absent value is an empty box, never a zero: "empty lets the data choose
  // it" is what the hint promises, and `Number("")` is 0.
  if (!present) field.input.value = "";

  if (descriptor.optional === true) {
    field.row.addEventListener(
      "change",
      (event) => {
        if (event.target !== field.input || field.input.value !== "") return;
        // Taken before `numberField`'s own listener, which refuses a cleared box
        // and rolls it back: here the empty box *is* the edit, and the setting
        // goes rather than being replaced by a value nobody chose.
        event.stopPropagation();
        options.onChange(undefined);
      },
      { capture: true },
    );
  }

  return { row: field.row, control: field.input };
}

function checkParts(
  descriptor: SettingsFieldDescriptor,
  options: SettingsFieldOptions,
  id: string,
  disabled: boolean,
): FieldParts {
  const { row, label } = fieldRow(descriptor.label);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = label.htmlFor = id;
  input.dataset["yunariChartSetting"] = descriptor.property;
  const current = options.value === true;
  input.checked = current;
  input.addEventListener("change", () => {
    if (disabled) {
      input.checked = current;
      return;
    }
    options.onChange(input.checked);
  });
  row.append(label, input);

  return { row, control: input };
}

function selectParts(
  descriptor: SettingsFieldDescriptor,
  options: SettingsFieldOptions,
  id: string,
  disabled: boolean,
): FieldParts {
  const { row, label } = fieldRow(descriptor.label);
  const select = document.createElement("select");
  select.id = label.htmlFor = id;
  select.dataset["yunariChartSetting"] = descriptor.property;

  if (descriptor.optional === true) {
    // A select has no empty value of its own, and the absent state is one the
    // hint promises for the fields that carry `optional` — so it gets a choice
    // of its own rather than being the one state the author cannot return to.
    const unset = document.createElement("option");
    unset.value = "";
    unset.textContent = uiCopy.panels.notSet;
    select.append(unset);
  }

  for (const option of descriptor.options ?? []) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }

  const current = typeof options.value === "string" ? options.value : "";
  select.value = current;
  select.addEventListener("change", () => {
    if (disabled) {
      select.value = current;
      return;
    }
    options.onChange(select.value === "" ? undefined : select.value);
  });
  row.append(label, select);

  return { row, control: select };
}

function fieldRow(labelText: string): {
  readonly row: HTMLElement;
  readonly label: HTMLLabelElement;
} {
  const row = document.createElement("div");
  row.className = "yunari-field";
  const label = document.createElement("label");
  label.textContent = labelText;

  return { row, label };
}

/** The hint for a screen reader, hidden from the eye: the tooltip is the same
    words for a pointer, and a line of hint under every field is the density
    this panel does not have. Returns the id the control describes itself by. */
function describe(row: HTMLElement, id: string, text: string): string {
  const note = document.createElement("p");
  note.className = "yunari-field-hint";
  note.id = id;
  note.textContent = text;
  note.style.cssText =
    "position:absolute;width:1px;height:1px;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
  row.append(note);

  return id;
}

/**
 * The tooltip is built on the first `pointerover` rather than with the field.
 *
 * Both the panel and the inspector column replace their whole subtree on every
 * edit, and an eager tooltip leaves a document listener and a detached row
 * behind per field per render. `pointerover` is the right event to arm on
 * because the platform fires it **before** `pointerenter`, so the tooltip this
 * creates is listening in time for the hover that armed it — one hover, not two.
 */
function armReasonTooltip(trigger: HTMLElement, text: string): void {
  trigger.addEventListener("pointerover", () => tooltip({ trigger, text }), {
    once: true,
  });
}
