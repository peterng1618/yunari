import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { DesignTokenPort } from "../selection-inspector/design-token-editor.js";
import {
  ChartContentFields,
  type ChartContentFieldsView,
  type ChartEdits,
  ChartPaintFields,
  type ChartPaintFieldsView,
} from "./chart-fields.js";

/**
 * The chart fields' test stage: the two bodies React renders, over an owner the
 * test supplies.
 *
 * Shared by `chart-fields.dom.test.tsx` (what each control writes) and
 * `index.dom.test.ts` (a real manager, a real projection, the controls the
 * column mounts). The bodies are read from getters on every render, so a stage
 * over the manager re-projects exactly what the column would see — which is the
 * claim a re-read after an edit is really making.
 *
 * The interaction helpers below are `runs.test-stage.tsx`'s, adapted to these
 * hooks. They are duplicated rather than shared because a shared harness would
 * be a third module the run editor's own tests would have to move to, and this
 * file is the one that can change without touching them.
 */

// React flushes work scheduled inside `act` only when it has been told it is in
// a test; without this the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Base UI's popups need three browser APIs jsdom has none of: floating-ui
// observes its anchor, the popup waits for its own open transition, and it
// re-dispatches a click through a `PointerEvent` to carry modifier state.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

// jsdom parses `:modal`/`:popover-open` slowly enough to dominate a file, and
// Base UI asks for both whenever a popup opens.
const nativeMatches = Element.prototype.matches;
Element.prototype.matches = Object.assign(function (
  this: Element,
  selector: string,
): boolean {
  if (selector === ":modal" || selector === ":popover-open") return false;
  return nativeMatches.call(this, selector);
}, nativeMatches);

export interface ChartFieldsStage {
  readonly host: HTMLElement;
  /** Re-projects both bodies and re-renders, as the inspector's re-read does. */
  readonly render: () => void;
  readonly content: () => ChartContentFieldsView | undefined;
  readonly paint: () => ChartPaintFieldsView | undefined;
  readonly dispose: () => Promise<void>;
}

export function mountChartFields(options: {
  readonly content: () => ChartContentFieldsView | undefined;
  readonly paint: () => ChartPaintFieldsView | undefined;
  readonly edits: ChartEdits;
  readonly designTokens?: DesignTokenPort | undefined;
}): ChartFieldsStage {
  // A popup renders into `document.body`, not the host, so a case that failed
  // before disposing would leave its list open for the next one to pick an
  // option out of. Each stage starts from an empty body.
  document.body.replaceChildren();

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  const render = (): void => {
    const content = options.content();
    const paint = options.paint();
    flushSync(() => {
      root.render(
        <>
          {content === undefined ? null : (
            <ChartContentFields view={content} edits={options.edits} />
          )}
          {paint === undefined ? null : (
            <ChartPaintFields
              view={paint}
              edits={options.edits}
              designTokens={options.designTokens}
            />
          )}
        </>,
      );
    });
  };

  render();

  return {
    host,
    render,
    content: options.content,
    paint: options.paint,
    dispose: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
export async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

export async function click(target: Element, detail = 0): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail }),
    );
  });
}

/** A mouse press. Base UI's list items commit a click only when the press that
 *  precedes it started on the item, so the press is part of the interaction. */
export async function pointerDown(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
  });
}

export async function press(target: Element, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

/** A real edit, as React sees one: the value goes in through the prototype's
 *  setter, because React replaces `value` with a tracker that would suppress a
 *  plain assignment. The draft commits on blur or Enter. */
export async function typeInto(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
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

/** Enters a draft and commits it, the way a person leaves the field. */
export async function edit(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await typeInto(input, value);
  await blur(input);
}

/** Off the field, which is what commits an edit. jsdom fires `blur` only for an
 *  element that holds focus, so the focus is taken and given up in one turn. */
export async function blur(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
    element.blur();
  });
}

/** The control a hook names, or a thrown error naming the hook. */
export function pick<T extends HTMLElement>(
  host: HTMLElement,
  hook: string,
): T {
  const found = host.querySelector<T>(`[${hook}]`);
  if (found === null) throw new Error(`no control carries ${hook}`);
  return found;
}

/** What a select shows, without the chevron its well draws beside the value. */
export function valueText(host: HTMLElement, hook: string): string {
  return (pick(host, hook).textContent ?? "").replace(/▼/g, "").trim();
}

/** Opens a select and picks the entry reading `option`. */
export async function choose(
  host: HTMLElement,
  hook: string,
  option: string,
): Promise<void> {
  const open = pick(host, hook);
  await click(open);
  await flush();
  const items = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  const item = items.find(
    (candidate) => (candidate.textContent ?? "").trim() === option,
  );
  if (item === undefined) {
    throw new Error(
      `no option reads "${option}"; the list holds ${items
        .map((candidate) => (candidate.textContent ?? "").trim())
        .join(", ")}`,
    );
  }
  await pointerDown(item);
  await click(item, 1);
  await flush();
}

/** The entries a select offers, in order. */
export async function optionsOf(
  host: HTMLElement,
  hook: string,
): Promise<readonly string[]> {
  const open = pick(host, hook);
  await click(open);
  await flush();
  const texts = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].map((candidate) => (candidate.textContent ?? "").trim());
  await press(open, "Escape");
  await flush();
  return texts;
}

/** Clicks the element a hook names — an add, remove or segment button. */
export async function clickHook(
  host: HTMLElement,
  hook: string,
): Promise<void> {
  await click(pick(host, hook));
}

/** Presses a segmented option, addressed by the hook on every segment. */
export async function segment(
  host: HTMLElement,
  hook: string,
  label: string,
): Promise<void> {
  const buttons = [...host.querySelectorAll<HTMLElement>(`button[${hook}]`)];
  const button = buttons.find(
    (candidate) => (candidate.textContent ?? "").trim() === label,
  );
  if (button === undefined) {
    throw new Error(
      `no segment reads "${label}"; the group holds ${buttons
        .map((candidate) => (candidate.textContent ?? "").trim())
        .join(", ")}`,
    );
  }
  await click(button);
}

/** The label of the segment currently pressed, or `undefined` when none is.
 *  Both spellings are accepted because the state is Base UI's to publish. */
export function pressedLabel(
  host: HTMLElement,
  hook: string,
): string | undefined {
  const pressed =
    host.querySelector<HTMLElement>(`button[${hook}][aria-pressed="true"]`) ??
    host.querySelector<HTMLElement>(`button[${hook}][data-pressed]`);
  return pressed === null || pressed === undefined
    ? undefined
    : (pressed.textContent ?? "").trim();
}
