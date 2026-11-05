// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tooltip } from "./tooltip.js";

/**
 * The editor's one tooltip, as a DOM function.
 *
 * The point of these cases is that the two callers cannot both be right unless
 * the behaviour is shared: `canvas-dock.tsx` is React, the selection inspector
 * builds elements with `document.createElement` and never sees React, and a
 * popup only one of them can use would be a second owner for it. So the contract
 * is the behaviour, and every case here is a behaviour a mouse-only
 * implementation would fail.
 */

const POPUP = ".editor-shell-tooltip";
const live: Array<{ destroy(): void }> = [];

function attach(text = "Glass blur", label = "A control"): HTMLButtonElement {
  const trigger = document.createElement("button");
  trigger.textContent = label;
  document.body.append(trigger);
  live.push(tooltip({ trigger, text }));
  return trigger;
}

const open = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(POPUP);

afterEach(() => {
  while (live.length > 0) live.pop()?.destroy();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the editor's shared tooltip", () => {
  it("puts the popup in the document with the class the shell and the e2e spec locate", () => {
    const trigger = attach();

    trigger.dispatchEvent(new Event("focus"));

    // Not "some element appears": `editor-shell.css` and
    // `tests/e2e/editor.spec.ts:1180` both name this class, and renaming it is
    // how the dock's existing coverage would quietly stop finding anything.
    expect(open()?.className).toBe("editor-shell-tooltip");
    expect(open()?.textContent).toBe("Glass blur");
    expect(open()?.getAttribute("role")).toBe("tooltip");
  });

  it("describes its trigger for a screen reader, not only for a pointer", () => {
    const trigger = attach("A Circle cannot be frosted");

    trigger.dispatchEvent(new Event("focus"));

    // The disclosure this control exists for is useless to a keyboard user if
    // it is a visual affordance only, so focus must both open the popup AND
    // name it. A hover-only tooltip passes every other case in this file.
    const id = open()?.id;
    expect(id).toBeTruthy();
    expect(trigger.getAttribute("aria-describedby")).toBe(id);
  });

  it("opens on focus without waiting, and on hover only after the delay", () => {
    vi.useFakeTimers();
    const trigger = attach();

    // A keyboard user has already committed to a control by focusing it; a
    // pointer merely crossing the dock has not. Same trigger, two timings.
    trigger.dispatchEvent(new Event("focus"));
    expect(open()).not.toBeNull();

    const other = document.createElement("button");
    document.body.append(other);
    live.push(tooltip({ trigger: other, text: "Second" }));

    other.dispatchEvent(new Event("pointerenter"));
    // The wait is a literal rather than the constant read back, so this case
    // fails when the constant moves. 220 is measured, in the dock as it ships
    //: crossing its 296px row of 26px controls in the 0.4–1.6s a hand
    // takes dwells at most 195ms on any one of them — so the label stays down for
    // the whole of a crossing, and is up well inside a deliberate hover's 400ms.
    vi.advanceTimersByTime(219);
    expect(open()?.textContent).toBe("Glass blur");
    vi.advanceTimersByTime(1);
    expect(open()?.textContent).toBe("Second");
  });

  it("keeps at most one popup open, so a `.editor-shell-tooltip` locator is unambiguous", () => {
    const first = attach("First", "One");
    const second = document.createElement("button");
    document.body.append(second);
    live.push(tooltip({ trigger: second, text: "Second" }));

    first.dispatchEvent(new Event("focus"));
    second.dispatchEvent(new Event("focus"));

    // Two elements with the class would make every locator that names it
    // resolve to two nodes, and the e2e spec's strict-mode click would throw.
    expect(document.querySelectorAll(POPUP)).toHaveLength(1);
    expect(open()?.textContent).toBe("Second");
  });

  it("sizes the popup independently of where it is put, so placing it cannot move it", () => {
    const trigger = attach(
      "A Path is author-drawn data and the product cannot know whether it is closed.",
    );

    trigger.dispatchEvent(new Event("focus"));

    // The width has to be the popup's own, and not a consequence of `left` and
    // `top` still being unset: an out-of-flow popup sizes against the space from
    // its static position to the viewport edge until it is pinned, so a reason
    // that wraps to three lines where it lands measured as one line, and the
    // height `place` worked from was short by two. The popup then landed on top
    // of its own trigger, which fires `pointerleave` on the trigger, dismisses
    // the popup, and re-arms the hover timer — so hover never settled and only
    // focus showed anything. The dock's one-word labels measured the same either
    // way, which is why that caller never showed it and this one did.
    const popup = open();
    expect(popup?.style.width).toBe("max-content");
    expect(popup?.style.maxWidth).toBe("280px");
  });

  it("removes the popup and the description on blur, and on Escape", () => {
    const trigger = attach();

    trigger.dispatchEvent(new Event("focus"));
    // A real KeyboardEvent, because the handler reads `event.key` and a bare
    // `Event` carries none — dispatching one here would fail for a reason that
    // has nothing to do with the control.
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(open()).toBeNull();
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);

    trigger.dispatchEvent(new Event("focus"));
    trigger.dispatchEvent(new Event("blur"));
    expect(open()).toBeNull();
  });

  it("carries a chord inside the popup, not in a popup of its own", () => {
    // A second `.editor-shell-tooltip` would make every locator that names the
    // class ambiguous — the same reason `:85` asserts at most one is open.
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const handle = tooltip({
      trigger,
      text: "Duplicate",
      shortcut: { printed: "Ctrl+D", spoken: "Control D" },
    });

    trigger.dispatchEvent(new Event("focus"));

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
    expect(handle).toBeDefined();
  });

  it("detaches every listener on destroy, so a removed control leaks nothing", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const handle = tooltip({ trigger, text: "Short-lived" });

    trigger.dispatchEvent(new Event("focus"));
    expect(open()).not.toBeNull();

    handle.destroy();
    expect(open()).toBeNull();

    // The inspector re-renders its whole subtree on every selection change, so
    // a destroyed tooltip that still responds would fire against a detached
    // node and put a popup nobody can dismiss over the editor.
    trigger.dispatchEvent(new Event("focus"));
    expect(open()).toBeNull();
  });
});
