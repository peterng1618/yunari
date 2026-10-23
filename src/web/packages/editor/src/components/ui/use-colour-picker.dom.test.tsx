// @vitest-environment jsdom
import { parseColor } from "@yunari/renderer-core";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useColourPicker } from "./use-colour-picker.js";

/**
 * The colours are asserted through `parseColor`, never by writing a hex here:
 * the design-token ratchet scans this file, and a hex literal in an assertion
 * is still a literal the language does not own.
 */
function expectColour(
  actual: string | undefined,
  expected: { r: number; g: number; b: number; a: number },
): void {
  expect(actual, "a colour was emitted").toBeDefined();
  expect(parseColor(actual as string)).toEqual(expected);
}

const HEX_TEXT = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/;

interface Harness {
  readonly change: ReturnType<typeof vi.fn>;
  readonly settled: ReturnType<typeof vi.fn>;
  click(testId: string): Promise<void>;
  commitText(input: string): Promise<void>;
  rerender(value: string): Promise<void>;
  text(): string;
  invalid(): boolean;
  close(): Promise<void>;
}

function Probe(props: {
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly onValueCommit: (next: string) => void;
}): React.JSX.Element {
  const input = React.useRef<HTMLInputElement>(null);
  const api = useColourPicker({
    value: props.value,
    onValueChange: props.onValueChange,
    onValueCommit: props.onValueCommit,
  });
  return (
    <>
      <output data-testid="text">{api.text}</output>
      <output data-testid="invalid">{api.invalid ? "true" : "false"}</output>
      <input data-testid="text-input" ref={input} />
      <button data-testid="hue" onClick={() => api.setChannel("hue", 120)} />
      <button
        data-testid="saturation"
        onClick={() => api.setChannel("saturation", 50)}
      />
      <button data-testid="alpha" onClick={() => api.setChannel("alpha", 50)} />
      <button data-testid="commit" onClick={() => api.commit()} />
      <button
        data-testid="commit-text"
        onClick={() => api.commitText(input.current?.value ?? "")}
      />
      <button
        data-testid="preset"
        onClick={() => api.choosePreset("rgb(0 255 0)")}
      />
      <button data-testid="reset" onClick={() => api.reset()} />
    </>
  );
}

async function mount(value: string): Promise<Harness> {
  const host = document.createElement("div");
  document.body.append(host);
  const change = vi.fn();
  const settled = vi.fn();
  const root = createRoot(host);

  const render = async (next: string): Promise<void> => {
    await React.act(async () => {
      root.render(
        <Probe value={next} onValueChange={change} onValueCommit={settled} />,
      );
    });
  };
  await render(value);

  const find = <T extends HTMLElement>(testId: string): T => {
    const found = host.querySelector<T>(`[data-testid="${testId}"]`);
    if (found === null) throw new Error(`The probe rendered no ${testId}.`);
    return found;
  };

  return {
    change,
    settled,
    click: async (testId) => {
      await React.act(async () => {
        find(testId).click();
      });
    },
    commitText: async (input) => {
      find<HTMLInputElement>("text-input").value = input;
      await React.act(async () => {
        find("commit-text").click();
      });
    },
    rerender: render,
    text: () => find("text").textContent ?? "",
    invalid: () => find("invalid").textContent === "true",
    close: async () => {
      root.unmount();
      host.remove();
      await React.act(async () => {});
    },
  };
}

it("emits live on every channel move and settles once with the last emitted value", async () => {
  const picker = await mount("rgb(255 0 0)");

  await picker.click("hue");
  await picker.click("saturation");
  await picker.click("alpha");

  expect(picker.change).toHaveBeenCalledTimes(3);
  expect(picker.settled).not.toHaveBeenCalled();

  const emitted = picker.change.mock.calls.map((call) => call[0] as string);
  // Pure red taken to hue 120 is pure green, so the first move is checkable.
  expectColour(emitted[0], { r: 0, g: 255, b: 0, a: 1 });
  expect(new Set(emitted).size, "each channel move emitted").toBe(3);

  await picker.click("commit");

  const last = emitted.at(-1);
  expect(picker.settled).toHaveBeenCalledOnce();
  expect(picker.settled).toHaveBeenCalledWith(last);
  expect(last).toMatch(HEX_TEXT);
  // A hex byte is the round-trip's unit, so 50% comes back as 128/255.
  expect(
    parseColor(last as string)?.a,
    "the last move was the alpha",
  ).toBeCloseTo(0.5, 2);

  await picker.close();
});

it("keeps a rejected draft as the field's value and calls neither callback", async () => {
  const picker = await mount("rgb(255 0 0)");

  await picker.commitText("nope");

  expect(picker.change).not.toHaveBeenCalled();
  expect(picker.settled).not.toHaveBeenCalled();
  expect(picker.invalid()).toBe(true);
  expect(picker.text()).toBe("nope");

  await picker.close();
});

it("settles nothing when an outside write lands during a refusal", async () => {
  const picker = await mount("rgb(255 0 0)");
  await picker.commitText("nope");

  // A publication lands mid-edit and must not replace the draft — nor may the
  // refused text leak into `latest`, where a settled commit could emit it.
  await picker.rerender("rgb(16 32 48)");
  expect(picker.text()).toBe("nope");

  await picker.click("commit");

  expect(picker.change).not.toHaveBeenCalled();
  expect(picker.settled).not.toHaveBeenCalled();

  await picker.close();
});

it("parses a multi-format value, emitting it both live and settled", async () => {
  const picker = await mount("rgb(255 0 0)");

  await picker.commitText("rgb(16 32 48)");

  expect(picker.change).toHaveBeenCalledOnce();
  expect(picker.settled).toHaveBeenCalledOnce();
  expectColour(picker.change.mock.calls[0]?.[0], { r: 16, g: 32, b: 48, a: 1 });
  expect(picker.settled.mock.calls[0]?.[0]).toBe(
    picker.change.mock.calls[0]?.[0],
  );
  expect(picker.invalid()).toBe(false);
  expect(picker.text()).toMatch(HEX_TEXT);

  await picker.close();
});

it("emits a preset live and settled exactly once", async () => {
  const picker = await mount("rgb(255 0 0)");

  await picker.click("preset");

  expect(picker.change).toHaveBeenCalledOnce();
  expect(picker.settled).toHaveBeenCalledOnce();
  expectColour(picker.change.mock.calls[0]?.[0], { r: 0, g: 255, b: 0, a: 1 });
  expect(picker.settled.mock.calls[0]?.[0]).toBe(
    picker.change.mock.calls[0]?.[0],
  );

  await picker.close();
});

it("re-derives its text when the authored value changes from outside", async () => {
  const picker = await mount("rgb(0 0 255)");
  expectColour(picker.text(), { r: 0, g: 0, b: 255, a: 1 });

  await picker.rerender("rgb(16 32 48)");

  expectColour(picker.text(), { r: 16, g: 32, b: 48, a: 1 });
  expect(picker.text()).toMatch(HEX_TEXT);

  await picker.close();
});

it("drops a refusal on reset and shows the authored value again", async () => {
  const picker = await mount("rgb(255 0 0)");
  await picker.commitText("nope");
  expect(picker.invalid()).toBe(true);

  await picker.click("reset");

  expect(picker.invalid()).toBe(false);
  expectColour(picker.text(), { r: 255, g: 0, b: 0, a: 1 });
  expect(picker.change).not.toHaveBeenCalled();

  await picker.close();
});
