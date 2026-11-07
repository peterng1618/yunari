// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectTarget } from "../object-actions.js";
import {
  resolveShortcuts,
  setActiveShortcuts,
} from "../shortcut-manager/bindings.js";
import { shortcutLabel } from "../shortcut-manager/display.js";
import {
  PRODUCT_SHORTCUTS,
  type ShortcutBinding,
} from "../shortcut-manager/index.js";
import { uiCopy } from "../ui-copy.js";
import type { EditorShellBridge } from "./bridge.js";
import { CanvasDock } from "./canvas-dock.js";

// A closed popup is kept mounted through its closing transition, and jsdom has
// no animations to finish; Base UI's own escape hatch completes the close
// synchronously so a focused control's popup replaces the previous one.
(
  globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true;

/** The bridge answers only what the dock's conversation needs: the selection
 *  gate (`snapshot`/`target`/`canArrange`) and the `run` a button calls. */
function bridgeOver(
  kind: ObjectTarget["kind"],
  locked = false,
): EditorShellBridge {
  const count = kind === "none" ? 0 : 1;
  return {
    snapshot: () => ({ selectedCount: count, locked, activeKind: kind }),
    target: () => ({ kind, locked, memberCount: count, isGroup: false }),
    canArrange: () => false,
    subscribe: () => () => undefined,
    run: vi.fn(),
  } as unknown as EditorShellBridge;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  // The live binding table is module state, so a case that rebinds puts it back.
  setActiveShortcuts(PRODUCT_SHORTCUTS);
});

/** The control as the shell mounts it (`createRoot`, not `@testing-library/react`,
 *  which this workspace does not depend on). */
async function mount(
  bridge: EditorShellBridge | undefined,
): Promise<HTMLDivElement> {
  const mounted = document.createElement("div");
  host = mounted;
  document.body.append(mounted);
  const created = createRoot(mounted);
  root = created;
  await act(async () => created.render(<CanvasDock bridge={bridge} />));
  return mounted;
}

/** Focus opens the tooltip, as it does for a keyboard user. The popup is
 *  portalled to `body`, so it is found there and never inside `container`. */
async function focusButton(
  container: HTMLElement,
  label: string,
): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`,
  );
  expect(button).not.toBeNull();
  await act(async () => button?.focus());
}

describe("the canvas dock's tooltips", () => {
  it("carries the chord of an action the product binds", async () => {
    const container = await mount(bridgeOver("object"));
    await focusButton(container, uiCopy.actions.duplicate);

    const chip = document.querySelector(".editor-shell-tooltip kbd");
    expect(chip?.textContent).toBe(shortcutLabel("edit.duplicate"));
  });

  it("omits the chip for an action the product does not bind", async () => {
    const container = await mount(bridgeOver("object"));
    await focusButton(container, uiCopy.actions.bringForward);

    const popup = document.querySelector(".editor-shell-tooltip");
    expect(popup).not.toBeNull();
    // Bring-forward has no binding, so the popup is the words alone and the
    // registry's absent `shortcut` is what makes it so.
    expect(popup?.querySelector("kbd")).toBeNull();
  });

  it("re-reads the chord after a rebind rather than holding the one it rendered with", async () => {
    // Review Focus 3 on this surface: the tooltip is the second of the four
    // things that print a chord. `tooltip()` is rebuilt from the chord on every
    // change, so what this proves is that the *component* re-rendered — a
    // render-time copy would keep printing the old mark, and the dock would
    // name a key that no longer runs the action beside it.
    const container = await mount(bridgeOver("object"));
    await focusButton(container, uiCopy.actions.duplicate);
    expect(
      document.querySelector(".editor-shell-tooltip kbd")?.textContent,
    ).toBe(shortcutLabel("edit.duplicate"));

    const moved: ShortcutBinding = {
      key: "j",
      modifier: true,
      shift: false,
      action: "edit.duplicate",
    };
    await act(async () => {
      setActiveShortcuts(resolveShortcuts({ "edit.duplicate": moved }));
    });

    // Focus again: the rebuilt popup is the rebuilt tooltip's, and `focus` is
    // the gesture that opens one without waiting out the hover delay.
    const button = container.querySelector<HTMLButtonElement>(
      `[aria-label="${uiCopy.actions.duplicate}"]`,
    );
    await act(async () => {
      button?.dispatchEvent(new Event("blur"));
    });
    await focusButton(container, uiCopy.actions.duplicate);

    expect(
      document.querySelector(".editor-shell-tooltip kbd")?.textContent,
    ).toBe("Ctrl+J");
  });
});

/** A bridge whose selection is `count` objects. `canArrange` is the answer the
 *  inspector's arrange row gates on now, so the dock's own mount reads it for
 *  nothing — it is here because the bridge interface carries it. */
function bridgeOverSelection(
  count: number,
  canArrange: boolean,
): EditorShellBridge {
  const kind = count === 0 ? "none" : "group";
  return {
    snapshot: () => ({ selectedCount: count, locked: false, activeKind: kind }),
    target: () => ({ kind, locked: false, memberCount: count, isGroup: false }),
    canArrange: () => canArrange,
    subscribe: () => () => undefined,
    run: vi.fn(),
  } as unknown as EditorShellBridge;
}

/** Drop the mounted root so a second `mount` in one case does not orphan the
 *  first's DOM in `body`. */
function unmount(): void {
  if (root !== undefined) act(() => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
}

/** The dock's remaining half, the arrange actions having moved into the
 *  selection inspector: the object actions, *filtered* — an action this
 *  selection cannot run is absent — and **no arrange button at all**.
 *
 *  The negative is worth a case of its own, because the failure mode of a move
 *  like this is two surfaces answering one question: the row that carries them
 *  has to be the inspector's alone, and this is the instrument that notices if
 *  it is not. */
describe("the canvas dock's one half", () => {
  it("draws only Paste with nothing selected", async () => {
    const container = await mount(bridgeOverSelection(0, false));

    // Paste's subject is the clipboard, so it is the one command the selection
    // gate does not withhold on an empty canvas.
    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-yunari-canvas-toolbar] button",
        ),
      ].map((button) => button.getAttribute("aria-label")),
    ).toEqual([uiCopy.actions.paste]);
  });

  it("carries no arrange action, whatever the selection is", async () => {
    const one = await mount(bridgeOverSelection(1, true));
    expect(
      one.querySelectorAll("[data-yunari-arrange-action]").length,
      "one object",
    ).toBe(0);
    // The dock is still the surface for this selection, so its absence above is
    // the arrange half's and not the whole row's.
    expect(
      one
        .querySelector("[data-yunari-canvas-toolbar]")
        ?.getAttribute("data-visible"),
    ).toBe("true");

    // Two objects is exactly the selection the eight are for, and this is the
    // mount that would draw them if the move had left them here.
    unmount();
    const two = await mount(bridgeOverSelection(2, true));
    expect(
      two.querySelectorAll("[data-yunari-arrange-action]").length,
      "two objects",
    ).toBe(0);
    // And the object half is drawn on the same mount, so the row is not simply
    // empty: `Duplicate` is runnable for a group of two.
    expect(
      two.querySelector<HTMLButtonElement>(
        `[aria-label="${uiCopy.actions.duplicate}"]`,
      ),
    ).not.toBeNull();
  });

  it("marks delete destructive and every other action not", async () => {
    const container = await mount(bridgeOverSelection(1, true));
    const marked = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-yunari-canvas-toolbar] button[data-yunari-destructive]",
      ),
    ];
    expect(marked.map((button) => button.getAttribute("aria-label"))).toEqual([
      uiCopy.actions.delete,
    ]);
  });
});
