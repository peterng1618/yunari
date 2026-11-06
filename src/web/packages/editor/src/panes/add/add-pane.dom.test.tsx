// @vitest-environment jsdom

/**
 * The Add pane's insert surface.
 *
 * **Membership and order come from `insertGroups()` and nowhere else.** The
 * pane draws a tile for whatever the owner declares, in the owner's order, so a
 * group added to the owner appears here the day it is added — and a group the
 * pane invented, or one it dropped, fails below rather than three tasks later.
 *
 * **Every tile wears the one icon vocabulary.** A card unit's glyph is the unit
 * it inserts, and no two units share one; a shape's is its kind and nothing
 * more.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNewObjectPanel, insertGroups } from "../../new-object-panel.js";
import {
  installStarterUnits,
  installThermalUnit,
  THERMAL_UNIT_ID,
  THERMAL_UNIT_LABEL,
} from "../../testing/widget-units.js";
import { uiCopy } from "../../ui-copy.js";
import { activeWidgetUnits } from "../../widget-packs.js";

/** A unit's label, as the installed pack declares it. */
function unitLabel(id: string): string {
  const unit = activeWidgetUnits().find((candidate) => candidate.id === id);
  if (unit === undefined) throw new Error(`no installed unit "${id}"`);
  return unit.label;
}

beforeEach(async () => {
  await installStarterUnits();
});

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
    historyManager: { attachEnvelope: () => {}, saveState: vi.fn() },
    textManager: { addText: vi.fn(), cancelPlacement: vi.fn() },
    errorManager: { warn: vi.fn(), error: vi.fn() },
  };
}

/**
 * The pane over a host of its own.
 *
 * `actions` is what the case that drives the pre-document refusal leaves out:
 * the pane has no session to insert through, which is the state the refusal was
 * written for. Nothing else here presses a tile hard enough to need one.
 *
 * Every pane is released in `afterEach`: the panel owns a React root, and a root
 * left mounted past the file schedules a commit that runs after the environment
 * is gone, where its `window` lookup throws.
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
  mounted.push(panel);
  return { pane: panel.root, editor, panel };
}

const mounted: ReturnType<typeof createNewObjectPanel>[] = [];

/** Release one pane now, so `afterEach` does not unmount it a second time. */
function release(panel: ReturnType<typeof createNewObjectPanel>): void {
  const at = mounted.indexOf(panel);
  if (at !== -1) mounted.splice(at, 1);
  panel.destroy();
}

afterEach(() => {
  for (const panel of mounted.splice(0)) panel.destroy();
});

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

  it("scopes each group by its id, and the scope is not the heading", () => {
    const { pane } = mount();

    // The e2e locators reach a tile through this hook, and the
    // heading above a group is copy. A hook derived from the heading would move
    // the day an author's copy did — which is the one thing it exists to stop.
    const scopes = [...pane.querySelectorAll("fieldset")].map((group) =>
      group.getAttribute("data-yunari-add-group"),
    );
    expect(scopes).toEqual(
      insertGroups()
        .filter((group) => group.label !== undefined)
        .map((group) => group.id),
    );
    expect(scopes).not.toContain(uiCopy.panels.shapes);
    expect(scopes).toContain("custom-shape");

    // And the shapes section — the one the row is about — is reachable by the
    // hook while still carrying its heading.
    const shapes = pane.querySelector('[data-yunari-add-group="shape"]');
    expect(shapes?.querySelector("legend")?.textContent).toBe(
      uiCopy.panels.shapes,
    );
    const custom = pane.querySelector('[data-yunari-add-group="custom-shape"]');
    expect(custom?.querySelector("legend")?.textContent).toBe(
      uiCopy.panels.customShapes,
    );
  });

  it("names a card unit with the library's own label, never a literal", () => {
    const { pane } = mount();

    // Change the installed pack's label and this fails: a tile that hard-codes
    // "CPU" agrees with the pack until the pack moves.
    expect(cardTile(pane, CPU_CARD).textContent).toBe(unitLabel(CPU_CARD));
  });

  it("wears a label no build-time card word could have produced", async () => {
    // "Thermal rig" comes from the installed pack, so no build-time card word
    // could have drawn this tile.
    await installThermalUnit();
    const { pane } = mount();

    expect(cardTile(pane, THERMAL_UNIT_ID).textContent).toBe(
      THERMAL_UNIT_LABEL,
    );
    expect(cardTile(pane, THERMAL_UNIT_ID).getAttribute("aria-label")).toBe(
      THERMAL_UNIT_LABEL,
    );
  });

  it("draws a card unit and a primitive with the one icon vocabulary", () => {
    const { pane } = mount();

    // The card library is a fixed set of eight, so a unit's tile is its own
    // mark; a primitive's tile is its kind. Both are lucide, so neither is a
    // second icon family and neither is the pane's own drawing.
    expect(
      cardTile(pane, CPU_CARD).querySelector("svg")?.getAttribute("class"),
    ).toMatch(/^lucide/);
    expect(
      shapeTile(pane, "rect").querySelector("svg")?.getAttribute("class"),
    ).toMatch(/^lucide/);
  });

  it("draws a glyph on every tile that is not the Text row, so none is blank", () => {
    const { pane } = mount();

    // the icon set: shapes and charts stay glyph-led rather than becoming text-only button
    // grids. The case above proves a card unit and a shape each wear the
    // vocabulary's glyph; this one proves every one of them wears something,
    // which an assertion of absence cannot — a tile drawing nothing at all
    // passed it.
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
    expect(tile.getAttribute("aria-label")).toBe(unitLabel(TRENDS_CARD));

    tile.focus();
    expect(document.querySelector(".editor-shell-tooltip")?.textContent).toBe(
      unitLabel(TRENDS_CARD),
    );
    tile.blur();
    expect(document.querySelector(".editor-shell-tooltip")).toBeNull();

    // The hover arm of the same registration. Hover waits rather than opening at
    // once, so the clock is controlled instead of waited on — 600 is a wait
    // longer than the delay, not a reading of it.
    vi.useFakeTimers();
    try {
      tile.dispatchEvent(new Event("pointerenter"));
      vi.advanceTimersByTime(600);
      expect(document.querySelector(".editor-shell-tooltip")?.textContent).toBe(
        unitLabel(TRENDS_CARD),
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
      release(panel);

      // Every grid tile carries a tooltip, and the tooltip's press-elsewhere
      // dismissal is a `document`-level `pointerdown`
      // (`editor-shell/controls/tooltip.ts:134`) removed only by its `destroy`.
      // Derived from the owner rather than a count: every offered object but
      // the Text row registers one. Asserted as added *and* removed: a count of
      // 0 removed would pass vacuously against a pane that registered none, and
      // a panel that removed its host node without unmounting the tree left the
      // listeners behind, once per session teardown.
      const tiles = insertGroups()
        .flatMap((group) => group.objects)
        .filter((object) => object.kind !== "text").length;
      expect(added["pointerdown"]).toBe(tiles);
      expect(removed["pointerdown"]).toBe(tiles);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("inserts a pack preset the host installed", async () => {
    const { setActiveUserPathPresets } = await import("../../path-presets.js");
    setActiveUserPathPresets([
      {
        id: "pack:pack-one:star",
        label: "Pack star",
        data: "M 0 0 L 10 0 L 5 10 Z",
        paint: "fill",
      },
    ]);
    const editor = editorStub();
    const host = document.createElement("div");
    document.body.append(host);
    const globals = {
      palette: {
        none: { name: "None", value: { kind: "solid", color: "transparent" } },
        background: {
          name: "Background",
          value: { kind: "solid", color: "black" },
        },
        panel: { name: "Panel", value: { kind: "solid", color: "black" } },
        text: { name: "Text", value: { kind: "solid", color: "white" } },
      },
      typeTokens: {
        body: { family: "Inter", weight: 500 },
        heading: { family: "Inter", weight: 600 },
        mono: { family: "Consolas, monospace", weight: 400 },
      },
    };
    const panel = createNewObjectPanel(host, editor as never, globals as never);
    try {
      panel.root
        .querySelector<HTMLButtonElement>(
          '[data-yunari-panel-add="pack:pack-one:star"]',
        )
        ?.click();
      expect(editor.errorManager.warn).not.toHaveBeenCalled();
      const inserted = editor.canvas.add.mock.calls[0]?.[0] as {
        readonly id?: string;
        readonly type?: string;
        get(property: string): unknown;
      };
      expect(inserted.type).toBe("path");
      expect(inserted.get("name")).toBe("Pack star");
      expect(inserted.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    } finally {
      panel.destroy();
      setActiveUserPathPresets([]);
    }
  });

  it("inserts a user preset under an id the envelope accepts", async () => {
    const { setActiveUserPathPresets } = await import("../../path-presets.js");
    setActiveUserPathPresets([
      {
        id: "user:abc",
        label: "Star",
        data: "M 0 0 L 10 0 L 5 10 Z",
        paint: "fill",
      },
    ]);
    const editor = editorStub();
    const host = document.createElement("div");
    document.body.append(host);
    const globals = {
      palette: {
        none: { name: "None", value: { kind: "solid", color: "transparent" } },
        background: {
          name: "Background",
          value: { kind: "solid", color: "black" },
        },
        panel: { name: "Panel", value: { kind: "solid", color: "black" } },
        text: { name: "Text", value: { kind: "solid", color: "white" } },
      },
      typeTokens: {
        body: { family: "Inter", weight: 500 },
        heading: { family: "Inter", weight: 600 },
        mono: { family: "Consolas, monospace", weight: 400 },
      },
    };
    const panel = createNewObjectPanel(host, editor as never, globals as never);
    try {
      panel.root
        .querySelector<HTMLButtonElement>('[data-yunari-panel-add="user:abc"]')
        ?.click();
      expect(editor.errorManager.warn).not.toHaveBeenCalled();
      const inserted = editor.canvas.add.mock.calls[0]?.[0] as {
        readonly id?: string;
        readonly type?: string;
        get(property: string): unknown;
      };
      expect(inserted.type).toBe("path");
      expect(inserted.get("name")).toBe("Star");
      // The id is persisted and validated by the envelope, whose alphabet has
      // no colon: the `user:` prefix must not reach it.
      expect(inserted.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    } finally {
      panel.destroy();
      setActiveUserPathPresets([]);
    }
  });
});
