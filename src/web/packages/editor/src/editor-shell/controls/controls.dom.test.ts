// @vitest-environment jsdom

import { defaultPieSettings, settingsFieldsFor } from "@yunari/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { numberField } from "./number-field.js";
import { isSettingVisible, settingsField } from "./settings-field.js";

afterEach(() => {
  document.body.replaceChildren();
});

/** A bounded field, the shape both the sides field and the blur field take. */
function bounded(over: (input: HTMLInputElement) => void) {
  const onCommit = vi.fn();
  const onReject = vi.fn();
  const field = numberField({
    label: "Sides",
    value: 6,
    min: 3,
    max: 32,
    data: "yunariSides",
    onReject,
    onCommit,
  });
  document.body.append(field.row);
  const input =
    field.row.querySelector<HTMLInputElement>("input[type=number]")!;
  over(input);
  return { field, input, onCommit, onReject };
}

const rangeOf = (row: HTMLElement) =>
  row.querySelector<HTMLInputElement>("input[type=range]");

const type = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event("change"));
};

describe("number field", () => {
  it("lands a value past the maximum on the bound", () => {
    const { input, onCommit, onReject } = bounded((input) =>
      type(input, "99999"),
    );

    // The clamp teaches the ceiling: the field now reads 48 where a revert
    // would read the old value and teach nothing.
    expect(onCommit).toHaveBeenCalledWith(32);
    expect(input.value).toBe("32");
    // Clamping is not a rejection. `onReject` is how glass.ts raises a toast
    // and how the inspector warns; firing it here would report a failure for an
    // edit that was applied.
    expect(onReject).not.toHaveBeenCalled();
  });

  it("lands a value under the minimum on the bound", () => {
    const { input, onCommit } = bounded((input) => type(input, "0"));

    expect(onCommit).toHaveBeenCalledWith(3);
    expect(input.value).toBe("3");
  });

  it("refuses an empty value rather than reading it as zero", () => {
    const { input, onCommit, onReject } = bounded((input) => type(input, ""));

    // `Number("")` is 0, so this must not become a clamp to the minimum: an
    // emptied box is a different mistake from a value that is too small.
    expect(onCommit).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("6");
  });

  it("refuses a non-integer rather than rounding it", () => {
    const { input, onCommit, onReject } = bounded((input) =>
      type(input, "6.5"),
    );

    expect(onCommit).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("6");
    // Refusing rather than clamping is the other half: a step of 1 says this
    // field has no 6.5, and a bound does not make one.
    expect(input.step).toBe("1");
  });

  it("commits a value inside the bound untouched", () => {
    const { input, onCommit, onReject } = bounded((input) => type(input, "12"));

    expect(onCommit).toHaveBeenCalledWith(12);
    expect(input.value).toBe("12");
    expect(onReject).not.toHaveBeenCalled();
  });

  it("states the bound in the field's own row", () => {
    const field = numberField({
      label: "Sides",
      value: 6,
      min: 3,
      max: 32,
      data: "yunariSides",
      onCommit: vi.fn(),
    });
    document.body.append(field.row);

    // Readable before the bound is tripped, which is the whole point: the
    // author finds the ceiling by looking, not by failing.
    expect(field.row.querySelector(".yunari-field-bound")?.textContent).toBe(
      "3–32",
    );
  });

  it("says nothing about a bound the field does not have", () => {
    const field = numberField({
      label: "X",
      value: 10,
      min: 1,
      data: "yunariGeometry",
      onCommit: vi.fn(),
    });
    document.body.append(field.row);

    // A half-stated range would be a lie in the same way a slider on a free
    // field is: it would promise a maximum the field has no opinion about.
    expect(field.row.querySelector(".yunari-field-bound")).toBeNull();
    expect(rangeOf(field.row)).toBeNull();
  });

  it("offers a slider on a bounded field and keeps the box the precise one", () => {
    const { field, input, onCommit } = bounded(() => undefined);
    const range = rangeOf(field.row);

    expect(range).not.toBeNull();
    // Two controls for one value, not two sources of truth: the box still
    // accepts a typed value, and it still clamps.
    expect(range?.min).toBe("3");
    expect(range?.max).toBe("32");
    type(input, "60");
    expect(onCommit).toHaveBeenLastCalledWith(32);
    // The slider followed the box rather than holding a stale thumb.
    expect(range?.value).toBe("32");
  });

  it("names the slider by the label the box already has", () => {
    const { field } = bounded(() => undefined);
    const range = rangeOf(field.row);
    const label = field.row.querySelector<HTMLLabelElement>("label")!;

    // A second string naming the same control is a second vocabulary, and it
    // is the one thing that drifts.
    expect(range?.getAttribute("aria-labelledby")).toBe(label.id);
    expect(label.textContent).toBe("Sides");
  });

  it("commits a whole drag as one edit", () => {
    const { field, onCommit, input } = bounded(() => undefined);
    const range = rangeOf(field.row)!;

    // A drag fires `input` per pixel and `change` once, on release.
    range.value = "10";
    range.dispatchEvent(new Event("input"));
    range.value = "20";
    range.dispatchEvent(new Event("input"));
    expect(onCommit).not.toHaveBeenCalled();

    range.dispatchEvent(new Event("change"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(20);
    // One value, one display: the box is not left showing the pre-drag number.
    expect(input.value).toBe("20");
  });

  it("rejects an out-of-range number instead of coercing it to zero", () => {
    const onCommit = vi.fn();
    const field = numberField({
      label: "Width",
      value: 100,
      min: 1,
      max: 4096,
      data: "yunariArtboardWidth",
      onCommit,
    });
    document.body.append(field.row);
    const input = field.row.querySelector("input")!;

    type(input, "abc");
    expect(onCommit).not.toHaveBeenCalled();
    expect(field.row.querySelector("[role=alert]")).not.toBeNull();
    // The field shows the last value it accepted, not the rejected text. This
    // is not cosmetic: `artboard-panel.dom.test.ts:44-52` already requires it,
    // and that test has to keep passing once the panel's own `render(current)`
    // rollback disappears with this refactor.
    expect(input.value).toBe("100");

    // The assertion above is only meaningful if a valid edit does commit —
    // otherwise "no handler ran" and "invalid input was refused" look
    // identical.
    type(input, "200");
    expect(onCommit).toHaveBeenCalledWith(200);
    expect(field.row.querySelector("[role=alert]")).toBeNull();

    // A refused edit must not become the new "last valid": the field still
    // shows 200, so a second refusal restores 200 rather than what it refused.
    type(input, "1.5");
    expect(input.value).toBe("200");

    // `setValue` is the only other writer of the input, and it is what the
    // panel's `render()` calls; it must not fire `onCommit`, or a re-render
    // would look like an edit and dirty the document on every refresh.
    field.setValue(320);
    expect(input.value).toBe("320");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("refuses through the field an edit the model itself rejected", () => {
    // `glass.ts` calls this when `writeTreatment` returns false: the field
    // accepted the value, so the field is the only thing that can roll it back.
    const onCommit = vi.fn();
    const field = numberField({
      label: "Glass blur",
      value: 12,
      min: 0,
      max: 48,
      data: "yunariGlassBlur",
      onCommit,
    });
    document.body.append(field.row);
    const input = field.row.querySelector("input")!;

    type(input, "60");
    expect(onCommit).toHaveBeenCalledWith(48);
    field.refuse(12);

    expect(input.value).toBe("12");
    expect(rangeOf(field.row)?.value).toBe("12");
    // The model's refusal is a different failure from the field's, and it says
    // so through the same line rather than a second kind of feedback.
    expect(field.row.querySelector("[role=alert]")?.textContent).toBe(
      "That value cannot be applied. Enter a number in range.",
    );
  });

  it("carries the dataset key the panel selectors read", () => {
    const field = numberField({
      label: "Width",
      value: 1,
      data: "yunariArtboardWidth",
      onCommit: vi.fn(),
    });

    expect(field.input.getAttribute("data-yunari-artboard-width")).toBe("");
  });
});

/** A scalar setting, the shape the descriptor table hands the control. */
const setting = {
  property: "thickness",
  label: "Arc thickness",
  kind: "number" as const,
  section: "content" as const,
  hint: "How wide the ring is drawn, in pixels.",
};

const controlOf = (field: HTMLElement): HTMLInputElement | HTMLSelectElement =>
  field.querySelector<HTMLInputElement | HTMLSelectElement>(
    "input, select, textarea",
  )!;

const numberBox = (field: HTMLElement): HTMLInputElement =>
  field.querySelector<HTMLInputElement>("input[type=number]")!;

describe("settings field", () => {
  it("renders the platform's control for each kind", () => {
    const number = settingsField(
      { ...setting, min: 0, max: 40, step: 2 },
      { value: 10, onChange: vi.fn() },
    );
    const box = numberBox(number);

    expect([box.min, box.max, box.step]).toEqual(["0", "40", "2"]);
    expect(box.value).toBe("10");
    // Keyed by the setting itself, so the panel, its specs and its screenshots
    // address the same control they addressed before the control moved.
    expect(box.id).toBe("yunari-chart-setting-thickness");
    expect(box.dataset["yunariChartSetting"]).toBe("thickness");
    expect(number.querySelector("label")?.htmlFor).toBe(box.id);

    const bool = settingsField(
      {
        ...setting,
        property: "roundCap",
        label: "Rounded ends",
        kind: "boolean",
      },
      { value: true, onChange: vi.fn() },
    );
    expect(controlOf(bool).type).toBe("checkbox");
    expect((controlOf(bool) as HTMLInputElement).checked).toBe(true);

    const select = settingsField(
      {
        ...setting,
        property: "interpolation",
        kind: "select",
        options: [
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
        ],
      },
      { value: "beta", onChange: vi.fn() },
    );
    // The descriptor's order is the picker's order; the surface does not sort.
    expect(
      [...select.querySelectorAll("option")].map((option) => option.value),
    ).toEqual(["alpha", "beta"]);
    expect(controlOf(select).value).toBe("beta");
  });

  it("commits an edit, and carries the descriptor's kind into it", () => {
    const onChange = vi.fn();
    const number = settingsField(setting, { value: 10, onChange });
    const box = numberBox(number);
    box.value = "12";
    box.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledWith(12);

    const booleanChange = vi.fn();
    const bool = settingsField(
      { ...setting, kind: "boolean" },
      { value: false, onChange: booleanChange },
    );
    const checkbox = controlOf(bool) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(booleanChange).toHaveBeenCalledWith(true);

    const selectChange = vi.fn();
    const select = settingsField(
      {
        ...setting,
        kind: "select",
        options: [{ value: "linear", label: "Linear" }],
      },
      { value: "linear", onChange: selectChange },
    );
    const picker = controlOf(select) as HTMLSelectElement;
    picker.value = "linear";
    picker.dispatchEvent(new Event("change"));
    expect(selectChange).toHaveBeenCalledWith("linear");
  });

  it("refuses an emptied number field rather than reading it as zero", () => {
    const onChange = vi.fn();
    const field = settingsField(
      { ...setting, min: 0 },
      { value: 10, onChange },
    );
    const box = numberBox(field);

    box.value = "";
    box.dispatchEvent(new Event("change"));

    // The setting is where it was: no commit, and the field says why and rolls
    // itself back. `Number("")` is 0, so an empty required box is a different
    // mistake from a value of zero.
    expect(onChange).not.toHaveBeenCalled();
    expect(field.querySelector("[role=alert]")).not.toBeNull();
    expect(box.value).toBe("10");
  });

  it("clears an optional field as a removal, and shows an absent value as empty", () => {
    const onChange = vi.fn();
    const field = settingsField(
      { ...setting, property: "barWidth", label: "Bar width", optional: true },
      { value: 20, onChange },
    );
    const box = numberBox(field);
    expect(box.value).toBe("20");

    box.value = "";
    box.dispatchEvent(new Event("change"));

    // Absent is the state the hint promises ("empty sizes it to the category"),
    // so clearing removes the key rather than writing a value nobody chose.
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(box.value).toBe("");
    expect(field.querySelector("[role=alert]")).toBeNull();

    const absent = settingsField(
      { ...setting, property: "barWidth", label: "Bar width", optional: true },
      { value: undefined, onChange: vi.fn() },
    );
    // Not `Number("")`: an unauthored value shows an empty box, never a zero.
    expect(numberBox(absent).value).toBe("");
  });

  it("describes the control with the descriptor's hint", () => {
    const field = settingsField(setting, { value: 4, onChange: vi.fn() });
    document.body.append(field);
    const described = controlOf(field).getAttribute("aria-describedby") ?? "";

    // The hint is a description, not a placeholder: it reaches a screen reader
    // on focus rather than only a pointer.
    expect(described).not.toBe("");
    expect(document.getElementById(described)?.textContent).toBe(setting.hint);
  });

  it("refuses an edit and gives the reason when the field is disabled", () => {
    const onChange = vi.fn();
    const reason = "A gauge draws one reading.";
    const field = settingsField(setting, {
      value: 4,
      onChange,
      disabledReason: reason,
    });
    document.body.append(field);
    const control = controlOf(field);

    // `aria-disabled`, not `disabled`: the control keeps its place in the tab
    // order so the reason below reaches a keyboard as well as a pointer.
    expect(control.getAttribute("aria-disabled")).toBe("true");
    const described = (control.getAttribute("aria-describedby") ?? "").split(
      " ",
    );
    expect(
      described.map((id) => document.getElementById(id)?.textContent),
    ).toContain(reason);

    control.value = "9";
    control.dispatchEvent(new Event("change"));
    expect(onChange).not.toHaveBeenCalled();
    expect(control.value).toBe("4");

    // The tooltip is built on the first hover — the platform fires `pointerover`
    // before `pointerenter`, so it is listening in time for the hover that
    // armed it — and its text is the reason.
    field.dispatchEvent(new Event("pointerover"));
    field.dispatchEvent(new Event("focus"));
    expect(document.querySelector(".editor-shell-tooltip")?.textContent).toBe(
      reason,
    );
  });

  it("is not a question at all in a state its visibleWhen does not match", () => {
    const fixedTotal = settingsFieldsFor("pie").find(
      (field) => field.property === "total.value",
    )!;

    expect(isSettingVisible(fixedTotal, defaultPieSettings)).toBe(false);
    expect(isSettingVisible(fixedTotal, { total: { kind: "fixed" } })).toBe(
      true,
    );
    // A descriptor with no condition is always a question.
    expect(isSettingVisible(setting, {})).toBe(true);
  });
});
