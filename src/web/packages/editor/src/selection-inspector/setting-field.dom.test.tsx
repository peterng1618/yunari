// @vitest-environment jsdom
import type { SettingsFieldDescriptor } from "@yunari/renderer-core";
import { defaultPieSettings, settingsFieldsFor } from "@yunari/renderer-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { isSettingVisible, SettingField } from "./setting-field.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(element: React.ReactNode): Promise<void> {
  if (root !== undefined) await act(async () => root?.unmount());
  host?.remove();
  host = document.createElement("div");
  document.body.append(host);
  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(element);
  });
}

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

const setting: SettingsFieldDescriptor = {
  property: "thickness",
  label: "Arc thickness",
  kind: "number",
  section: "content",
  hint: "How wide the ring is drawn, in pixels.",
};

const control = (): HTMLInputElement | HTMLSelectElement =>
  host!.querySelector<HTMLInputElement | HTMLSelectElement>(
    "input, select, textarea",
  )!;

it("renders the control the descriptor's kind asks for", async () => {
  await mount(
    <SettingField descriptor={setting} value={10} onChange={vi.fn()} />,
  );

  const box = host!.querySelector<HTMLInputElement>('input[type="text"]')!;
  expect(box.value).toBe("10");
  expect(box.id).toBe("yunari-chart-setting-thickness");
  expect(box.dataset["yunariChartSetting"]).toBe("thickness");
  expect(host!.querySelector("label")?.htmlFor).toBe(box.id);

  await mount(
    <SettingField
      descriptor={{ ...setting, property: "roundCap", kind: "boolean" }}
      value={true}
      onChange={vi.fn()}
    />,
  );
  const toggle = host!.querySelector<HTMLButtonElement>(
    "button[data-yunari-chart-setting]",
  )!;
  expect(toggle.getAttribute("aria-checked")).toBe("true");

  await mount(
    <SettingField
      descriptor={{
        ...setting,
        property: "interpolation",
        kind: "select",
        options: [
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
        ],
      }}
      value="beta"
      onChange={vi.fn()}
    />,
  );
  // Base UI opens its list only on press, so a closed select is read by the
  // value it carries and the label it prints.
  const trigger = host!.querySelector("[data-yunari-value]")!;
  expect(trigger.getAttribute("data-yunari-value")).toBe("beta");
  expect(trigger.textContent).toBe("Beta");

  // Both bounds present is a track, and the caller's resolved bounds are the
  // ones it takes.
  await mount(
    <SettingField
      descriptor={setting}
      value={10}
      bounds={{ min: 0, max: 40 }}
      onChange={vi.fn()}
    />,
  );
  const track = host!.querySelector<HTMLInputElement>('input[type="range"]')!;
  expect(track.max).toBe("40");
  expect(track.dataset["yunariChartSetting"]).toBe("thickness");
});

it("commits the next value, and an optional empty as a removal", async () => {
  const onChange = vi.fn();
  await mount(
    <SettingField
      descriptor={{ ...setting, optional: true }}
      value={20}
      onChange={onChange}
    />,
  );
  const box = host!.querySelector<HTMLInputElement>('input[type="text"]')!;
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(box) as HTMLInputElement,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(box, "");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    box.blur();
  });

  // Absent is the state `optional` promises, so clearing removes the key
  // rather than writing a zero nobody chose.
  expect(onChange).toHaveBeenCalledWith(undefined);
});

it("describes the control with the descriptor's hint", async () => {
  await mount(
    <SettingField descriptor={setting} value={4} onChange={vi.fn()} />,
  );
  const described = control().getAttribute("aria-describedby") ?? "";

  expect(described).not.toBe("");
  expect(document.getElementById(described)?.textContent).toBe(setting.hint);
});

it("refuses the edit and names the reason when the field is disabled", async () => {
  const onChange = vi.fn();
  const reason = "A gauge draws one reading.";
  await mount(
    <SettingField
      descriptor={setting}
      value={4}
      disabledReason={reason}
      onChange={onChange}
    />,
  );
  const box = control();

  // `aria-disabled`, not `disabled`: the reason stays reachable by keyboard.
  expect(box.getAttribute("aria-disabled")).toBe("true");
  const described = (box.getAttribute("aria-describedby") ?? "").split(" ");
  expect(
    described.map((id) => document.getElementById(id)?.textContent),
  ).toContain(reason);
});

it("is not a question in a state its visibleWhen does not match", () => {
  const fixedTotal = settingsFieldsFor("pie").find(
    (field) => field.property === "total.value",
  )!;

  expect(isSettingVisible(fixedTotal, defaultPieSettings)).toBe(false);
  expect(isSettingVisible(fixedTotal, { total: { kind: "fixed" } })).toBe(true);
  expect(isSettingVisible(setting, {})).toBe(true);
});

it("asks a notEquals question only in an authored state that differs", () => {
  const segmented: SettingsFieldDescriptor = {
    ...setting,
    visibleWhen: { path: ["segmentDivisor"], notEquals: "100" },
  };

  // Absent means continuous, which is not the state the field is about.
  expect(isSettingVisible(segmented, {})).toBe(false);
  expect(isSettingVisible(segmented, { segmentDivisor: 100 })).toBe(false);
  expect(isSettingVisible(segmented, { segmentDivisor: 20 })).toBe(true);
});
