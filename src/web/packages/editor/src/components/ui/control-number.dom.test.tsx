// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ControlNumber } from "./control-number.js";
import { ControlPair } from "./control-pair.js";

// React flushes work scheduled inside `act` only when it has been told it is in
// a test; without this the update lands after the assertion.
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

/** A draft, as React sees one: the prototype setter, because React replaces
 *  `value` with a tracker that would suppress a plain assignment. */
async function draft(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as HTMLInputElement,
      "value",
    )?.set;
    if (setter === undefined) input.value = value;
    else setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Off the field, which commits a draft. Focus is taken in the same turn
 *  because jsdom fires `blur` only for an element that holds it. */
async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.focus();
    input.blur();
  });
}

/**
 * A read-only half is a measurement, not a write: it shows the number the
 * canvas draws and commits nothing, without looking disabled or broken.
 */
it("renders a read-only half's value and commits nothing", async () => {
  const onCommit = vi.fn();
  await mount(
    <ControlNumber label="Width" value={299} readOnly onCommit={onCommit} />,
  );
  const field = host?.querySelector<HTMLInputElement>('input[type="text"]')!;

  expect(field.value).toBe("299");
  expect(field.readOnly).toBe(true);
  expect(field.disabled).toBe(false);

  // A draft can reach the control without a keystroke; the commit refuses it.
  await draft(field, "320");
  await blur(field);
  expect(onCommit).not.toHaveBeenCalled();
});

it("leaves the other half of a pair editable", async () => {
  const width = vi.fn();
  const height = vi.fn();
  await mount(
    <ControlPair
      label="Size"
      halves={[
        { label: "W", value: 10, readOnly: true, onCommit: width },
        { label: "H", value: 20, onCommit: height },
      ]}
    />,
  );
  const [first, second] = [
    ...(host?.querySelectorAll<HTMLInputElement>('input[type="text"]') ?? []),
  ];

  expect(first?.readOnly).toBe(true);
  expect(second?.readOnly).toBe(false);

  await draft(first!, "30");
  await blur(first!);
  expect(width).not.toHaveBeenCalled();

  await draft(second!, "40");
  await blur(second!);
  expect(height).toHaveBeenCalledWith(40);
});
