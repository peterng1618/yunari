// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ControlTooltip, TOOLTIP_MAX_WIDTH } from "./tooltip.js";

/**
 * The editor's one tooltip.
 *
 * Every caller is React, so the popup is React's too: Base UI's `Trigger`
 * donates hover/focus opening, dismissal and positioning, and this suite holds
 * it to the behaviour the DOM module guaranteed — the class the shell and
 * `tests/e2e/editor.spec.ts` locate by, the description a screen reader hears,
 * one popup at a time, and the popup's own width rather than one the anchor
 * decides.
 */

// Base UI's popup needs three browser APIs jsdom has none of: floating-ui
// observes its anchor, the popup waits for its own open transition, and its
// events carry a pointer type.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;
// A closed popup is kept mounted through its closing transition.
// `useAnimationsFinished` waits for that transition to report, and jsdom has no
// animations to finish, so the popup would stay in the document with
// `data-closed` and every single-popup assertion would read the previous
// tooltip. Base UI's own escape hatch completes the close synchronously.
(
  globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const POPUP = ".editor-shell-tooltip";
let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await act(async () => root?.unmount());
  }
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function mount(children: ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => created.render(children));
  return host;
}

function one(
  label: string,
  shortcut?: { printed: string; spoken: string },
): ReactElement {
  return (
    <ControlTooltip label={label} shortcut={shortcut}>
      <button type="button">{label}</button>
    </ControlTooltip>
  );
}

const open = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(POPUP);

function trigger(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );
  expect(button, `no trigger ${text}`).toBeDefined();
  return button as HTMLButtonElement;
}

it("puts the popup in the document with the class the shell and the e2e spec locate", async () => {
  const host = await mount(one("Glass blur"));
  const button = trigger(host, "Glass blur");

  await act(async () => button.focus());

  // Not "some element appears": `editor-shell.css` and
  // `tests/e2e/editor.spec.ts` both name this class, and renaming it is how
  // the shell's existing coverage would quietly stop finding anything.
  expect(open()?.className).toBe("editor-shell-tooltip");
  expect(open()?.textContent).toBe("Glass blur");
  expect(open()?.getAttribute("role")).toBe("tooltip");
});

it("describes its trigger for a screen reader, not only for a pointer", async () => {
  const host = await mount(one("A Circle cannot be frosted"));
  const button = trigger(host, "A Circle cannot be frosted");

  await act(async () => button.focus());

  // The disclosure this control exists for is useless to a keyboard user if it
  // is a visual affordance only, so focus must both open the popup AND name
  // it. A hover-only tooltip passes every other case in this file.
  const id = open()?.id;
  expect(id).toBeTruthy();
  expect(button.getAttribute("aria-describedby")).toBe(id);
});

it("opens on focus without waiting, and on hover only after the delay", async () => {
  vi.useFakeTimers();
  const host = await mount(
    <>
      {one("Glass blur", undefined)}
      {one("Second", undefined)}
    </>,
  );

  // A keyboard user has already committed to a control by focusing it; a
  // pointer merely crossing the dock has not. Same trigger, two timings.
  await act(async () => trigger(host, "Glass blur").focus());
  expect(open()).not.toBeNull();

  const second = trigger(host, "Second");
  // The wait is a literal rather than the constant read back, so this case
  // fails when the constant moves. 220 is measured, in the dock as it ships:
  // crossing its 296px row of 26px controls in the 0.4–1.6s a hand takes
  // dwells at most 195ms on any one of them — so the label stays down for the
  // whole of a crossing, and is up well inside a deliberate hover's 400ms.
  await act(async () => {
    second.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true, relatedTarget: null }),
    );
    // The hover arm opens on a rest: entering clears the previous close, and
    // the rest timer is armed by the first move after it.
    second.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    second.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        movementX: 0,
        movementY: 0,
      }),
    );
  });
  await act(async () => vi.advanceTimersByTimeAsync(219));
  expect(open()?.textContent).toBe("Glass blur");
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(open()?.textContent).toBe("Second");
});

it("keeps at most one popup open, so a `.editor-shell-tooltip` locator is unambiguous", async () => {
  const host = await mount(
    <>
      {one("First", undefined)}
      {one("Second", undefined)}
    </>,
  );

  await act(async () => trigger(host, "First").focus());
  await act(async () => trigger(host, "Second").focus());

  // Two elements with the class would make every locator that names it resolve
  // to two nodes, and the e2e spec's strict-mode click would throw.
  expect(document.querySelectorAll(POPUP)).toHaveLength(1);
  expect(open()?.textContent).toBe("Second");
});

it("sizes the popup independently of where it is put, so placing it cannot move it", async () => {
  const host = await mount(
    one(
      "A Path is author-drawn data and the product cannot know whether it is closed.",
    ),
  );

  const button = host.querySelector("button");
  expect(button).not.toBeNull();
  await act(async () => button?.focus());

  // The width has to be the popup's own, and not a consequence of `left` and
  // `top` still being unset: an out-of-flow popup sizes against the space from
  // its static position to the viewport edge until it is pinned, so a reason
  // that wraps to three lines where it lands measured as one line, and the
  // popup then landed on its own trigger, whose `pointerleave` dismissed it.
  const popup = open();
  expect(popup?.style.width).toBe("max-content");
  expect(popup?.style.maxWidth).toBe(`${TOOLTIP_MAX_WIDTH}px`);
});

it("removes the popup and the description on blur, and on Escape", async () => {
  const host = await mount(one("Glass blur"));
  const button = trigger(host, "Glass blur");

  await act(async () => button.focus());
  // A real KeyboardEvent, because the handler reads `event.key` and a bare
  // `Event` carries none.
  await act(async () => {
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  // The popup unmounts once its close transition completes, which is a couple
  // of microtasks after the state change rather than the same frame.
  await act(async () => {});
  await act(async () => {});
  expect(open()).toBeNull();
  expect(button.hasAttribute("aria-describedby")).toBe(false);

  await act(async () => button.focus());
  await act(async () => button.blur());
  await act(async () => {});
  await act(async () => {});
  expect(open()).toBeNull();
});

it("carries a chord inside the popup, not in a popup of its own", async () => {
  // A second `.editor-shell-tooltip` would make every locator that names the
  // class ambiguous — the same reason the single-popup case exists.
  const host = await mount(
    one("Duplicate", { printed: "Ctrl+D", spoken: "Control D" }),
  );

  await act(async () => trigger(host, "Duplicate").focus());

  const popups = document.querySelectorAll(POPUP);
  expect(popups).toHaveLength(1);
  const chip = popups[0]?.querySelector("kbd");
  expect(chip?.textContent).toBe("Ctrl+D");
  // The chip shows a key and is read as a key. `⌘` is announced as "place of
  // interest sign" and `⇧` as "upwards white arrow" — names of pictures — so
  // the mark is visible and the word is what reaches a screen reader.
  expect(chip?.getAttribute("aria-label")).toBe("Control D");
  // The words are still the whole description for a screen reader; the chip is
  // a visual affordance and contributes its text once, not twice.
  expect(popups[0]?.textContent).toContain("Duplicate");
});

it("takes the popup with it when the control unmounts, so nothing is stranded", async () => {
  const host = await mount(one("Short-lived"));
  await act(async () => trigger(host, "Short-lived").focus());
  expect(open()).not.toBeNull();

  // The inspector re-renders its whole subtree on every selection change: a
  // popup that outlived its trigger would sit over the editor with nothing to
  // dismiss it.
  await act(async () => root?.render(<span>gone</span>));
  expect(open()).toBeNull();
});
