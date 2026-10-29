// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import type { RailSlot } from "./rail.js";
import { createShellLayout, type ShellLayout } from "./shell-layout.js";

/** A rail slot, found by the id it carries: a slot draws a glyph, so there is
 *  no label a reader could match on. */
function segment(root: HTMLElement, id: RailSlot): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(
    `.editor-shell-rail button[data-rail-slot="${id}"]`,
  )!;
}

/** The pane's column, which clips rather than scrolls and is what a collapse
 *  hides. */
function panel(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>("aside.editor-shell-panel")!;
}

/** The box the overflow rule leaves the scroll to: the showing pane's body. `choosePane`
 *  reads and writes each pane's offset through it. */
function scroller(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>(
    ".editor-shell-pane:not([hidden]) > .editor-shell-pane-body",
  )!;
}

/** The Composition pane's body whether or not it is the pane showing, so the
 *  restore can be asserted on a box the case has just zeroed — a pass then
 *  cannot come from the element remembering what the case wrote into it. */
function layersBody(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>(
    '[data-yunari-panel="layers"] > .editor-shell-pane-body',
  )!;
}

/** One frame, which is when `choosePane` restores. */
async function frame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

/** Models the browser's `scrollTop` on a hidden box.
 *
 *  jsdom has no layout, so its `scrollTop` round-trips whatever value it was
 *  given and remembers it while the element is `hidden` — the opposite of the
 *  browser, where a `display: none` box has no box to scroll and the getter
 *  answers 0 whatever was last written. An assertion over jsdom's own
 *  behaviour therefore passes whether or not the offset survives a collapse,
 *  which is the defect under test; this is the one pin in this file that can
 *  fail. `editor-rail.spec.ts` pins the same thing against a real browser,
 *  where the model below is not needed to make it bite.
 *
 *  The body is hidden by the **column** rather than by its own attribute — the
 *  pane is the one showing and the column is `hidden` — so `node.hidden` alone
 *  would never fire and the model would pin nothing. */
function modelHiddenScrollTop(node: HTMLElement): void {
  let offset = 0;
  Object.defineProperty(node, "scrollTop", {
    get: () => (node.closest("[hidden]") === null ? offset : 0),
    set: (value: number) => {
      offset = value;
    },
    configurable: true,
  });
}

/** A shell in a detached-from-layout document, with the showing pane's body's
 *  scrollable height stated: jsdom does not lay out, and what is under test is
 *  the offset surviving the swap, not the height that makes it scrollable. */
function mount(): { readonly layout: ShellLayout; readonly root: HTMLElement } {
  const root = document.createElement("div");
  document.body.append(root);
  const layout = createShellLayout(root);
  Object.defineProperty(scroller(root), "scrollHeight", {
    value: 5000,
    configurable: true,
  });
  return { layout, root };
}

/**
 * The rail is single-pane, so opening Add really does take the composition
 * list down and build it again. The selection, the inspector's geometry and
 * the canvas handles all survive that swap; only the scroll did not, and with
 * the Starter's 52 rows — more in a theme an author has built — finding your
 * place again is the whole cost of glancing at the assets.
 *
 * The offset lives on the showing pane's **body** (the overflow rule, `vg-208`), so each
 * case reads and writes it there rather than on the column around it.
 */
describe("the rail keeps each pane where you left it", () => {
  it("returns the layer list to the offset it was scrolled to", async () => {
    const { layout, root } = mount();
    scroller(root).scrollTop = 499;

    segment(root, "add").click();
    await frame();
    expect(scroller(root).scrollTop).toBe(0);

    // Zeroed while the pane is off screen, so the assertion below is the
    // shell's own restore and not the box remembering the case's write.
    layersBody(root).scrollTop = 0;

    segment(root, "composition").click();
    await frame();
    expect(scroller(root).scrollTop).toBe(499);

    layout.destroy();
    root.remove();
  });

  it("returns it there too when the panel was closed in between", async () => {
    const { layout, root } = mount();
    modelHiddenScrollTop(scroller(root));
    scroller(root).scrollTop = 499;

    // Collapsing is the step that loses the place. The column goes `display:
    // none`, so the offset is only readable before this, and the swap that
    // follows must not save over what was read here with the 0 a hidden box
    // answers with.
    await act(async () => segment(root, "composition").click());
    expect(panel(root).hidden).toBe(true);

    await act(async () => segment(root, "add").click());
    await frame();
    expect(scroller(root).scrollTop).toBe(0);

    await act(async () => segment(root, "composition").click());
    await frame();
    expect(scroller(root).scrollTop).toBe(499);

    layout.destroy();
    root.remove();
  });
});
