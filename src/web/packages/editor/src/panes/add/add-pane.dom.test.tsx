// @vitest-environment jsdom

/**
 * The Add pane's insert surface.
 *
 * **Membership and order come from `insertGroups()` and nowhere else.** The
 * pane draws a tile for whatever the owner declares, in the owner's order, so a
 * group added to the owner appears here the day it is added — and a group the
 * pane invented, or one it dropped, fails below rather than three tasks later.
 *
 * **A card unit may be depicted; a primitive may not be depicted beyond its
 * kind.** The library is a fixed set of eight, so a unit's tile is honest; a
 * shape is a kind, so its tile is the kind and nothing more.
 */
import { describe, expect, it, vi } from "vitest";
import { createNewObjectPanel, insertGroups } from "../../new-object-panel.js";
import { uiCopy } from "../../ui-copy.js";

/** The CPU unit, whose label is the one the hard-coded-label red proof moves. */
const CPU_CARD = "group-cpu-card";

/** The unit whose label is the one that clips in the 246px pane. */
const TRENDS_CARD = "group-trends-card";

/** The construction surface a tile writes through, with its diagnostics
 *  reachable — a refusal is reported there rather than thrown at the author. */
function editorStub() {
  return {
    canvas: {
      add: vi.fn(),
      setActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
      getObjects: vi.fn((): unknown[] => []),
    },
    artboard: () => ({ width: 1920, height: 1080 }),
    historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
    textManager: { addText: vi.fn() },
    errorManager: { warn: vi.fn(), error: vi.fn() },
  };
}

/**
 * The pane over a host of its own.
 *
 * `actions` is what the case that drives the pre-document refusal leaves out:
 * the pane has no session to insert through, which is the state the refusal was
 * written for. Nothing else here presses a tile hard enough to need one.
 */
function mount(actions?: Parameters<typeof createNewObjectPanel>[3]): {
  readonly pane: HTMLElement;
  readonly editor: ReturnType<typeof editorStub>;
  readonly panel: ReturnType<typeof createNewObjectPanel>;
} {
  const editor = editorStub();
  const host = document.createElement("div");
  document.body.append(host);
  const panel = createNewObjectPanel(host, editor as never, undefined, actions);
  return { pane: panel.root, editor, panel };
}

/** The headings the pane drew, in the order it drew them. */
function groupHeadings(pane: HTMLElement): readonly (string | null)[] {
  return [...pane.querySelectorAll("fieldset > legend")].map(
    (legend) => legend.textContent,
  );
}

/** Every tile the pane drew, which is every control it offers. */
function tileCount(pane: HTMLElement): number {
  return pane.querySelectorAll("button").length;
}

function cardTile(pane: HTMLElement, cardId: string): HTMLButtonElement {
  return pane.querySelector<HTMLButtonElement>(
    `[data-yunari-panel-card="${cardId}"]`,
  )!;
}

function shapeTile(pane: HTMLElement, kind: string): HTMLButtonElement {
  return pane.querySelector<HTMLButtonElement>(
    `[data-yunari-panel-add="${kind}"]`,
  )!;
}

describe("the Add pane's insert surface", () => {
  it("offers each group insertGroups() declares, and no list of its own", () => {
    const { pane } = mount();

    // The owner's own answer, not a copy of its rule: a pane that named its
    // groups itself would agree today and diverge the day a group is added.
    expect(groupHeadings(pane)).toEqual(
      insertGroups()
        .map((group) => group.label)
        .filter((label) => label !== undefined),
    );
    expect(tileCount(pane)).toBe(
      insertGroups().flatMap((group) => group.objects).length,
    );
  });

  it("scopes each group by its kind, and the scope is not the heading", () => {
    const { pane } = mount();

    // The e2e locators reach a tile through this hook (`vg-211`), and the
    // heading above a group is copy. A hook derived from the heading would move
    // the day an author's copy did — which is the one thing it exists to stop.
    const scopes = [...pane.querySelectorAll("fieldset")].map((group) =>
      group.getAttribute("data-yunari-add-group"),
    );
    expect(scopes).toEqual(
      insertGroups()
        .filter((group) => group.label !== undefined)
        .map((group) => group.kind),
    );
    expect(scopes).not.toContain(uiCopy.panels.shapes);

    // And the shapes section — the one the row is about — is reachable by the
    // hook while still carrying its heading.
    const shapes = pane.querySelector('[data-yunari-add-group="shape"]');
    expect(shapes?.querySelector("legend")?.textContent).toBe(
      uiCopy.panels.shapes,
    );
  });

  it("names a card unit with the library's own label, never a literal", () => {
    const { pane } = mount();

    // Change `uiCopy.cardLibrary.cpu` and this fails: a tile that hard-codes
    // "CPU" agrees with the copy until the copy moves.
    expect(cardTile(pane, CPU_CARD).textContent).toBe(uiCopy.cardLibrary.cpu);
  });

  it("depicts a card unit and does not depict a primitive beyond its kind", () => {
    const { pane } = mount();

    // the control set: the library is a fixed set of eight, so a unit tile may be drawn.
    // A primitive's tile is its kind — a shape glyph, never a card diagram.
    expect(cardTile(pane, CPU_CARD).querySelector("svg")).not.toBeNull();
    expect(
      shapeTile(pane, "rect").querySelector("[data-yunari-card-diagram]"),
    ).toBeNull();
  });

  it("draws a glyph on every tile that is not the Text row, so none is blank", () => {
    const { pane } = mount();

    // the icon set: shapes and charts stay glyph-led rather than becoming text-only button
    // grids. The case above proves a shape does not wear a *card's* diagram;
    // this one proves every one of them wears something, which an assertion of
    // absence cannot — a tile drawing nothing at all passed it.
    const drawn = [
      ...pane.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((tile) => !tile.classList.contains("yunari-add-text"));

    // Derived from the owner, so a primitive or family added there is required to
    // be drawn here rather than being skipped by a count nobody moved.
    expect(drawn.map((tile) => tile.getAttribute("aria-label"))).toEqual(
      insertGroups()
        .flatMap((group) => group.objects)
        .filter((object) => object.kind !== "text")
        .map((object) => object.label),
    );
    for (const tile of drawn) {
      expect(tile.querySelector("svg")).not.toBeNull();
    }
  });

  it("discloses a grid tile's whole label on focus and on hover, where that label may clip", () => {
    const { pane } = mount();
    const tile = cardTile(pane, TRENDS_CARD);

    // "Performance trends" is the one label that truncates at 246px — 86px of
    // text in a 41px box — so it is the one tile that must be able to say its
    // whole name even though it also draws it. `aria-label` covers the
    // programmatic half; focus and hover cover the other two, and all three read
    // one string.
    expect(tile.getAttribute("aria-label")).toBe(uiCopy.cardLibrary.trends);

    tile.focus();
    expect(document.querySelector(".editor-shell-tooltip")?.textContent).toBe(
      uiCopy.cardLibrary.trends,
    );
    tile.blur();
    expect(document.querySelector(".editor-shell-tooltip")).toBeNull();

    // The hover arm of the same registration. Hover waits rather than opening at
    // once, so the clock is controlled instead of waited on — 600 is a wait
    // longer than the delay, not a reading of it (`vg-450`).
    vi.useFakeTimers();
    try {
      tile.dispatchEvent(new Event("pointerenter"));
      vi.advanceTimersByTime(600);
      expect(document.querySelector(".editor-shell-tooltip")?.textContent).toBe(
        uiCopy.cardLibrary.trends,
      );
    } finally {
      vi.useRealTimers();
      tile.dispatchEvent(new Event("pointerleave"));
    }
  });

  it("refuses, in words, before a document is open, rather than offering tiles that insert nothing", async () => {
    const { pane, editor } = mount();

    // The `constructing` wrapper owns the refusal: with no session behind the
    // tile, a press reaches `errorManager.warn("controls", …)` rather than
    // vanishing into a click that does nothing.
    cardTile(pane, CPU_CARD).click();
    await Promise.resolve();

    expect(editor.errorManager.warn.mock.calls).toEqual([
      ["controls", expect.stringMatching(/session|document/i)],
    ]);
  });

  it("releases the document listeners its tiles registered, on the panel's own disposal path", () => {
    const added: Record<string, number> = {};
    const removed: Record<string, number> = {};
    const tally =
      (into: Record<string, number>) =>
      (type: string): void => {
        into[type] = (into[type] ?? 0) + 1;
      };
    const addSpy = vi
      .spyOn(document, "addEventListener")
      .mockImplementation(
        tally(added) as unknown as typeof document.addEventListener,
      );
    const removeSpy = vi
      .spyOn(document, "removeEventListener")
      .mockImplementation(
        tally(removed) as unknown as typeof document.removeEventListener,
      );

    try {
      const { panel } = mount();
      panel.destroy();

      // Every grid tile carries a tooltip, and the tooltip's press-elsewhere
      // dismissal is a `document`-level `pointerdown`
      // (`editor-shell/controls/tooltip.ts:134`) removed only by its `destroy`.
      // 8 units + 8 primitives + 6 families = 22, the Text row exempt. Asserted
      // as added *and* removed: a count of 0 removed would pass vacuously
      // against a pane that registered none, and a panel that removed its host
      // node without unmounting the tree left all twenty-two behind, once per
      // session teardown.
      expect(added["pointerdown"]).toBe(22);
      expect(removed["pointerdown"]).toBe(22);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
