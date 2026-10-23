// @vitest-environment jsdom
import type {
  AssetReference,
  Background,
  Binding,
  ChartContent,
  ChartFamily,
} from "@yunari/renderer-core";
import {
  defaultGaugeSettings,
  instantIn,
  MAX_OBJECT_NAME_LENGTH,
} from "@yunari/renderer-core";
import { Wedge, YunariChart } from "@yunari/scene-fabric";
import {
  ActiveSelection,
  Canvas,
  FabricImage,
  type FabricObject,
  Group,
  IText,
  Line,
  Path,
  Point,
  Polygon,
  Polyline,
  Rect,
  Textbox,
  util,
} from "fabric/es";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_LIBRARY } from "../card-library.js";
import {
  type ChartFieldTarget,
  chartContentView,
  chartPaintView,
} from "../chart-manager/panel.js";
import { createObjectLockManager } from "../object-lock-manager/index.js";
import { uiCopy } from "../ui-copy.js";
import { idleCrop } from "./idle-crop.test-stage.js";
import { createSelectionInspector } from "./index.js";
import {
  type ChartFieldsPort,
  perKindColumn,
  rendersExtra,
  SELECTION_KINDS,
  type SelectionKind,
  selectionKindOf,
} from "./per-kind-column.js";
import { click, slide } from "./runs.test-stage.js";

// jsdom has never had a `PointerEvent`, and Base UI re-dispatches a click
// through one to carry modifier state; a toggle click throws without it.
window.PointerEvent ??= MouseEvent as never;

// The column's sections keep their open state in React now, and React only
// flushes a click's update inside `act` — so the one test that clicks a header
// needs an act environment. Nothing else here drives React directly.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Every `setup` attaches its host so a field can hold focus; the body is
// emptied between cases so the hosts (and the popups a control portals into it)
// do not pile up.
afterEach(() => {
  document.body.replaceChildren();
});

/** A chart with settings but no live ECharts behind it: what the inspector
    reads is the object, not the engine that paints it. */
function chartOf(
  family: ChartFamily,
  settings: ChartContent["settings"],
): YunariChart {
  const chart = Object.create(YunariChart.prototype) as YunariChart;
  chart.family = family;
  chart.settings = settings;
  return chart;
}

/** A canvas stub that answers selection and history like the editor's.
 *
 *  `active` may be a value or a getter. A getter is how a test deselects: the
 *  selection has to be able to change *after* the inspector is built, or the
 *  branch that reads it cannot be reached. `objects` decouples the document
 *  from the selection — after a history restore the scene holds the object
 *  while nothing is selected, and a stub that ties the two together cannot
 *  express the case the restore branch exists for. */
function canvasWith(
  active: unknown | (() => unknown),
  objects?: () => readonly unknown[],
) {
  const read =
    typeof active === "function" ? (active as () => unknown) : () => active;
  return {
    getActiveObject: () => read(),
    getObjects: () => {
      if (objects !== undefined) return objects();
      const current = read();
      return current === undefined ? [] : [current];
    },
    requestRenderAll: vi.fn(),
    fire: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function setup(
  active: unknown | (() => unknown),
  options: {
    readonly nodeBindings?: (nodeId: string) => readonly Binding[];
    readonly onNodeBindingsChange?: (
      nodeId: string,
      bindings: readonly Binding[],
    ) => void;
    readonly objects?: () => readonly unknown[];
    readonly backgroundSelected?: () => boolean;
    readonly background?: () => Background | undefined;
    readonly assets?: () => readonly AssetReference[];
    readonly onBackgroundChange?: (next: Background | undefined) => void;
  } = {},
) {
  const history = { saveState: vi.fn() };
  // Attached: nothing is focusable while it is detached, and a plan-1 control
  // commits on blur — which jsdom fires only for an element that can hold
  // focus. `afterEach` empties the body so the hosts do not pile up.
  const host = document.createElement("div");
  document.body.append(host);
  const editor = {
    canvas: canvasWith(active, options.objects),
    historyManager: history,
    errorManager: { warn: vi.fn(), error: vi.fn() },
    cropManager: idleCrop(),
  };
  const inspector = createSelectionInspector(host, {
    editor: editor as never,
    globals: {
      palette: {
        ink: { name: "Ink", value: { kind: "solid", color: "#e8ecf3" } },
      },
      typePresets: {
        body: {
          name: "Body",
          value: { family: "Inter", size: 16, weight: "600" },
        },
      },
    } as never,
    refreshGlass: vi.fn(),
    ...options,
  });
  return { inspector, host, history, editor };
}

/**
 * The weekday word a language spells for an instant, read straight from `Intl`
 * rather than from the module under test, so a broken formatter cannot agree
 * with itself.
 */
function weekdayWord(instant: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${instant.slice(0, 10)}T00:00:00Z`));
}

/**
 * A draft in a plan-1 text field, as React sees one: through the prototype's
 * setter, because React replaces `value` on the node with a tracker that would
 * suppress a plain assignment.
 */
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

/** Off the field, which is what the control commits. Its own turn, because a
 *  blur in the same turn as the draft would read it before React applied it. */
async function leave(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.focus();
    input.blur();
  });
}

/** A committed edit on one of the plan-1 controls. */
async function edit(input: HTMLInputElement, value: string): Promise<void> {
  await draft(input, value);
  await leave(input);
}

/** The starter's CPU card, revived from `CARD_LIBRARY`'s own authored JSON
 *  through Fabric's enliven utility — so the case starts from the document the
 *  product ships rather than from numbers re-typed into this file. Its panel is
 *  `frostedCard("cpu-card", 421, 187, 280, 307)`, so the card's centre is
 *  (561, 340.5). */
async function starterCpuCard(): Promise<Group> {
  const unit = CARD_LIBRARY.find(
    (candidate) => candidate.id === "group-cpu-card",
  );
  if (unit === undefined) throw new Error("no group-cpu-card unit");
  const [object] = await util.enlivenObjects<FabricObject>([unit.build()]);
  if (!(object instanceof Group)) {
    throw new Error("group-cpu-card did not revive as a group");
  }
  return object;
}

describe("the selection inspector", () => {
  let rect: Rect;

  beforeEach(() => {
    rect = new Rect({ left: 0, top: 0, width: 40, height: 20 });
  });

  it("names where to choose from when nothing is selected", () => {
    const { host } = setup(undefined);

    // One line saying what to do, rather than an empty column or a section
    // header standing over no fields.
    expect(
      host.querySelector("[data-yunari-nothing-selected]")?.textContent,
    ).toBe(uiCopy.inspectorFields.nothingSelected);
    expect(host.querySelectorAll("[data-yunari-section]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-yunari-geometry]")).toHaveLength(0);
  });

  /**
   * The background is a selected subject that is no Fabric object, so the
   * column describes it through `backgroundColumn` rather than through
   * `perKindColumn` — and its writes leave through the document setter, because
   * there is no object to save a Fabric history entry for.
   */
  describe("the background layer", () => {
    function backgroundSelected(
      background: Background = {
        media: { assetId: "loop", bounds: "theme" },
      },
    ) {
      const onBackgroundChange = vi.fn();
      const built = setup(undefined, {
        backgroundSelected: () => true,
        background: () => background,
        assets: () => [],
        onBackgroundChange,
      });
      return { ...built, onBackgroundChange };
    }

    it("describes the background when the bridge says it is selected", () => {
      const { host } = backgroundSelected();

      expect(host.textContent).toContain("Background");
      expect(host.querySelector("[data-yunari-background]")).toBeTruthy();
    });

    it("writes a background edit through the document setter and no Fabric field", async () => {
      const { host, history, onBackgroundChange } = backgroundSelected();
      const flipX = host.querySelector<HTMLButtonElement>(
        "[data-yunari-background-flip-x]",
      )!;

      await click(flipX);

      expect(onBackgroundChange).toHaveBeenCalledWith(
        expect.objectContaining({
          media: expect.objectContaining({ flipX: true }),
        }),
      );
      // A background write is envelope state, not a Fabric edit: no scene
      // history entry records it.
      expect(history.saveState).not.toHaveBeenCalled();
    });

    it("refuses an offset outside -1..1 at the write boundary", async () => {
      // A paired half carries no bounds (`PairHalfView` has none), so the only
      // guard for this value is the one behind the commit.
      const { host, editor, onBackgroundChange } = backgroundSelected();
      const offsetX = host.querySelector<HTMLInputElement>(
        "[data-yunari-background-offset-x]",
      )!;
      expect(offsetX.value).toBe("0");

      await edit(offsetX, "150");

      expect(onBackgroundChange).not.toHaveBeenCalled();
      expect(editor.errorManager.warn).toHaveBeenCalled();
    });

    it("refuses a background edit when no write port is mounted, without moving the revision", async () => {
      // A build with no document setter cannot write, so the field reports a
      // refusal rather than a success that changed nothing. The revision is part
      // of every row's key, so a bump would remount the control: the same node
      // still standing is what says the failed write did not move it.
      const built = setup(undefined, {
        backgroundSelected: () => true,
        background: () => ({ media: { assetId: "loop", bounds: "theme" } }),
        assets: () => [],
      });
      const offset = built.host.querySelector<HTMLInputElement>(
        "[data-yunari-background-offset-x]",
      )!;
      expect(offset.value).toBe("0");

      await edit(offset, "50");

      expect(built.editor.errorManager.warn).toHaveBeenCalled();
      expect(
        built.host.querySelector("[data-yunari-background-offset-x]"),
        "the refusal did not bump the revision",
      ).toBe(offset);
    });

    it("commits an offset inside -1..1", async () => {
      // The refusal above is only half a rule: a switch that refused every
      // offset would satisfy it, so a valid move is asserted beside it. The
      // field prints a percentage, so 50 is the 0.5 the document holds.
      const { host, onBackgroundChange } = backgroundSelected();
      const offsetX = host.querySelector<HTMLInputElement>(
        "[data-yunari-background-offset-x]",
      )!;
      expect(offsetX.value).toBe("0");

      await edit(offsetX, "50");

      expect(onBackgroundChange).toHaveBeenCalledWith(
        expect.objectContaining({
          media: expect.objectContaining({ offsetX: 0.5 }),
        }),
      );
    });
  });

  it("shows the selected object's geometry in whole units", () => {
    const { host } = setup(rect);
    const value = (key: string) =>
      host.querySelector<HTMLInputElement>(`[data-yunari-geometry="${key}"]`)
        ?.value;

    expect(value("left")).toBe("0");
    expect(value("width")).toBe("40");
    expect(value("height")).toBe("20");
    expect(value("angle")).toBe("0");
  });

  it("refuses a fractional rotation rather than storing it", async () => {
    const { host, history } = setup(rect);
    // Rotation is a bounded number, so it is a slider; the typed route is the
    // well beside the track, and that is where a draft is refused.
    const track = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="angle"]',
    )!;
    expect(track.type).toBe("range");
    expect(track.min).toBe("-360");
    expect(track.max).toBe("360");
    const angle = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry-well="angle"]',
    )!;
    angle.focus();

    await edit(angle, "45.5");

    // The deleted `numberField` refused a non-integer rather than rounding it.
    // Without that rule the fraction reaches `object.set({angle})` and lands a
    // history entry behind it. The rejected draft stays in the box, with its
    // reason, so the author can correct it.
    expect(rect.angle).toBe(0);
    expect(history.saveState).not.toHaveBeenCalled();
    expect(angle.value).toBe("45.5");
    expect(angle.getAttribute("aria-invalid")).toBe("true");
  });

  it("stores a whole rotation", async () => {
    const { host, history } = setup(rect);
    const angle = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry-well="angle"]',
    )!;

    await edit(angle, "45");

    expect(rect.angle).toBe(45);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("rotating a group from the inspector keeps its centre where it was", async () => {
    const card = await starterCpuCard();
    // The authored card: left/top 421,187 over 280 × 307, so its centre is
    // (561, 340.5). Assert it before the write too — a case that only reads the
    // centre afterwards cannot tell "held" from "was never there".
    expect(card.getRelativeCenterPoint()).toMatchObject({ x: 561, y: 340.5 });

    const { host } = setup(card);
    const well = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry-well="angle"]',
    )!;
    await edit(well, "45");

    // Rotating the property alone swings the box about its authored left/top
    // corner, which lands the centre at about (411.5, 394.6) — 54px away.
    // Fabric's own gesture holds the centre (`centeredRotation`), and the two
    // routes agree only if this one does too (vg-475).
    expect(card.getRelativeCenterPoint().x).toBeCloseTo(561, 6);
    expect(card.getRelativeCenterPoint().y).toBeCloseTo(340.5, 6);
    expect(card.angle).toBe(45);
  });

  it("moves the object and records exactly one history entry", async () => {
    const { host, history } = setup(rect);
    const left = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="left"]',
    )!;

    await edit(left, "120");

    expect(rect.left).toBe(120);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("pairs X/Y and W/H on one row each, with rotation alone", () => {
    const { host } = setup(rect);
    const input = (key: string) =>
      host.querySelector<HTMLInputElement>(`[data-yunari-geometry="${key}"]`)!;
    // A pair is a layout, and `[data-yunari-pair]` is the row it lays out.
    const rowOf = (key: string) => input(key).closest("[data-yunari-pair]");

    // Non-vacuous: a pairing assertion on two absent rows would compare null
    // to null and pass for the stacked layout this replaced.
    expect(rowOf("left")).not.toBeNull();
    expect(rowOf("width")).not.toBeNull();
    // A pair shares its row element; the two pairs are distinct rows.
    expect(rowOf("left")).toBe(rowOf("top"));
    expect(rowOf("width")).toBe(rowOf("height"));
    expect(rowOf("left")).not.toBe(rowOf("width"));
    // Rotation stands alone: Layer renders it as its own row, never as one
    // half of the pairs Position builds.
    expect(input("angle").closest("[data-yunari-pair]")).toBeNull();
    expect(input("angle").closest('[data-yunari-section="layer"]')).not.toBe(
      null,
    );
  });

  it("commits a paired edit as one history entry", async () => {
    const { host, history } = setup(rect);
    const width = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="width"]',
    )!;

    await edit(width, "80");

    // The sibling's unchanged value is written back too, but that is a no-op
    // for geometry: one committed edit, one entry.
    expect(rect.width * rect.scaleX).toBe(80);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("commits only the edited half, leaving a fractional sibling alone", async () => {
    // A drag leaves fractional scale, and the field shows the rounded read of
    // it. Editing one half must not write the sibling, or the round-trip
    // through the field would quantise the dimension the author never touched.
    rect.set({ width: 520, height: 36.32, scaleX: 1.0009, scaleY: 1.00444 });
    const { host, history } = setup(rect);
    const width = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="width"]',
    )!;
    expect(width.value).toBe("520");

    await edit(width, "1040");

    expect(rect.scaleX).toBeCloseTo(2, 5);
    // The half the author did not edit keeps its fractional scale: a commit
    // that wrote the sibling would land it on `Math.round(36.48)` and quantise
    // it to about 0.991.
    expect(rect.scaleY).toBeCloseTo(1.00444, 5);
    expect(rect.height * rect.scaleY).toBeCloseTo(36.48, 2);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("refuses a value that would make the object invalid", async () => {
    const { host, history } = setup(rect);
    const width = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="width"]',
    )!;

    await edit(width, "-5");

    // Was restored to 40 with nothing recorded. The floor is 1, so -5 now
    // lands on 1: reverting is what made the bound undiscoverable.
    expect(width.value).toBe("1");
    expect(rect.scaleX).toBeGreaterThan(0);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("offers opacity as a slider, as a percentage of Fabric's 0-1", () => {
    rect.set({ opacity: 0.5 });
    const { host } = setup(rect);
    const opacity = host.querySelector<HTMLInputElement>(
      "[data-yunari-opacity]",
    )!;

    // A bounded number is DESIGN.md's slider (§5) — Fabric's own 0–1, projected
    // here as 0–100 — so the control is a track and the well reads the
    // percentage. `inspector-controls.html` names opacity as its example, and
    // the glass blur drew the same conclusion one directory away.
    expect(opacity.type).toBe("range");
    expect(opacity.getAttribute("min")).toBe("0");
    expect(opacity.getAttribute("max")).toBe("100");
    expect(opacity.value).toBe("50");
  });

  it("commits a percentage from the opacity slider", async () => {
    rect.set({ opacity: 0.5 });
    const { host, history } = setup(rect);
    const opacity = host.querySelector<HTMLInputElement>(
      "[data-yunari-opacity]",
    )!;

    // One keyboard step, the gesture jsdom can resolve (see `slide`): 50% → 51%,
    // stored as Fabric's 0–1, one history entry.
    await slide(opacity, "ArrowRight");

    expect(rect.opacity).toBeCloseTo(0.51, 6);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("stops the opacity slider at full rather than exceeding it", async () => {
    rect.set({ opacity: 0.5 });
    const { host } = setup(rect);
    const opacity = host.querySelector<HTMLInputElement>(
      "[data-yunari-opacity]",
    )!;

    // The ceiling is the control's own bound, so the sweep stops at Fabric's 1
    // and the well reads it back. `writeOpacity`'s refusal of a value outside
    // 0–100 remains the guard for a bypassed commit.
    await slide(opacity, "End");

    expect(rect.opacity).toBe(1);
    expect(opacity.value).toBe("100");
  });

  it("shows the object's display name and writes an edit back to it", async () => {
    rect.set("name", "Header panel");
    const { host, history } = setup(rect);
    const name = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;

    expect(name.value).toBe("Header panel");

    await edit(name, "Header rule");

    expect(rect.get("name")).toBe("Header rule");
    // One committed edit, one history entry (§67).
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("leaves the name field empty for an object that has none", () => {
    // Absence is what a scene authored before the field looks like; showing the
    // id in the field would make an unnamed object look named.
    const { host } = setup(rect);
    const name = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;

    expect(name.value).toBe("");
  });

  it("clears the name when the author empties the field", async () => {
    rect.set("name", "Header panel");
    const { host, history } = setup(rect);
    const name = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;

    await edit(name, "   ");

    // The key goes rather than holding a blank label, so the layer list falls
    // back to the id exactly as it does for a scene that never had a name.
    expect(rect.get("name")).toBeUndefined();
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("refuses a name past the published bound rather than storing it", async () => {
    rect.set("name", "Header panel");
    const { host, history, editor } = setup(rect);
    const name = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;

    await edit(name, "x".repeat(MAX_OBJECT_NAME_LENGTH + 1));

    // The envelope would refuse this on import, so a save would throw; the field
    // rejects the edit and shows what the object actually carries.
    expect(rect.get("name")).toBe("Header panel");
    expect(name.value).toBe("Header panel");
    expect(history.saveState).not.toHaveBeenCalled();
    expect(editor.errorManager.warn).toHaveBeenCalled();
  });

  it("gives the name field an accessible label", () => {
    const { host } = setup(rect);
    const name = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;
    const label = host.querySelector<HTMLLabelElement>(
      `label[for="${name.id}"]`,
    );

    expect(label?.textContent).toBe("Name");
    // A field the author can only reach by pointer is not a control.
    expect(name.tagName).toBe("INPUT");
  });

  it("withholds the name field on a locked object, like every other write", () => {
    rect.set("locked", true);
    const { host } = setup(rect);

    expect(host.querySelector("[data-yunari-name]")).toBeNull();
  });

  it("announces the edit so the layer list republishes the row", async () => {
    // The layer row prints this name, and the panel caches its projection, so
    // a rename that only wrote the object would leave the two surfaces
    // disagreeing until something else happened to republish.
    rect.set("name", "Header panel");
    const { host, editor } = setup(rect);
    const name = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;

    await edit(name, "Header rule");

    expect(editor.canvas.fire).toHaveBeenCalledWith(
      "object:modified",
      expect.objectContaining({ target: rect }),
    );
  });

  it("announces nothing when a name is refused", async () => {
    rect.set("name", "Header panel");
    const { host, editor } = setup(rect);
    const name = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;

    await edit(name, "x".repeat(MAX_OBJECT_NAME_LENGTH + 1));

    expect(editor.canvas.fire).not.toHaveBeenCalled();
  });

  /**
   * §13.1's **long unresolved reference**: the whole reference and the reason,
   * both read off one row.
   *
   * **The browser cannot carry this row, which is why it is read here.** The
   * envelope validator admits only a document whose every reference names a
   * declared global, and a declared palette token must hold a colour
   * (`palettePaints`), so a live session never holds an unresolved reference to
   * render. A reference written onto a live object afterwards is worse than
   * unrendered: the shell's own `snapshot()` re-validates the serialised theme
   * and throws, and selecting the object takes the whole inspector column down
   * with it. The rendering was the read-only section's, and item 17 removed that
   * section with the last case that read it.
   */
  it("offers a shape none of a text object's fields", () => {
    const { host } = setup(rect);

    // A shape has no text layout to edit, so it must not be offered one.
    for (const field of [
      "[data-yunari-text-align]",
      "[data-yunari-text-wrap]",
      "[data-yunari-text-overflow]",
    ]) {
      expect(host.querySelector(field)).toBeNull();
    }
  });

  /** The two ways a selection can go away, which the column must treat
   *  differently — spec §541 and §552's "the right column empties on deselect".
   *
   *  The previous version of this test never dropped the selection, so it
   *  passed whichever branch `target()` took; these two fail if the branch is
   *  swapped back. */
  it("empties on a deselect, and re-binds across a history restore", () => {
    const rect = new Rect({ left: 0, top: 0, width: 40, height: 20 });
    rect.set({ id: "cpu-card" });
    let active: FabricObject | undefined = rect;
    // The scene keeps the object across the restore even though the selection
    // does not — that is what makes re-binding possible at all.
    const { host, editor } = setup(() => active, { objects: () => [rect] });

    const handlerFor = (name: string): (() => void) => {
      const call = editor.canvas.on.mock.calls.find(
        ([registered]) => registered === name,
      );
      expect(call, `nothing is subscribed to ${name}`).toBeDefined();
      return call?.[1] as () => void;
    };

    expect(host.querySelector("[data-yunari-name]")).not.toBeNull();

    // A pointer deselect: Fabric clears the selection and no history is
    // involved. The column names where to choose from and holds no field.
    active = undefined;
    handlerFor("selection:cleared")();
    expect(
      host.querySelector("[data-yunari-nothing-selected]"),
      "a deselect must empty the column",
    ).not.toBeNull();
    expect(host.querySelector("[data-yunari-name]")).toBeNull();

    // A history restore drops the selection too, and must NOT empty it: the id
    // survives the rebuild, so the author keeps the panel they were working in.
    active = rect;
    handlerFor("selection:created")();
    active = undefined;
    handlerFor("editor:history-state-loaded")();
    expect(
      host.querySelector("[data-yunari-name]"),
      "a history restore must keep the panel the author was working in",
    ).not.toBeNull();
    expect(host.querySelector("[data-yunari-nothing-selected]")).toBeNull();
  });

  it("refuses a stale opacity event rather than mutating the old selection", async () => {
    rect.set({ opacity: 0.5 });
    const { host, history, editor } = setup(rect);
    // The control the author is holding, bound to `rect` at its revision.
    const held = host.querySelector<HTMLInputElement>("[data-yunari-opacity]")!;
    const other = new Rect({ left: 0, top: 0, width: 10, height: 10 });
    other.set({ opacity: 0.5 });
    const handlerFor = (name: string): (() => void) => {
      const call = editor.canvas.on.mock.calls.find(
        ([registered]) => registered === name,
      );
      return call?.[1] as () => void;
    };

    // The selection really moves to `other`, so the column republishes and every
    // row is re-keyed by its new revision. A raw `change` no longer commits now
    // that the element is Base UI's slider, so the gesture is a person's: focus
    // the held control and step it. The row's revision key is what discards it —
    // the write must reach neither object and add no history.
    (editor.canvas as { getActiveObject: () => unknown }).getActiveObject =
      () => other;
    await act(async () => {
      handlerFor("selection:created")();
    });
    await slide(held, "ArrowRight");

    expect(rect.opacity).toBe(0.5);
    expect(other.opacity).toBe(0.5);
    expect(history.saveState).not.toHaveBeenCalled();
  });

  it("withholds only the fields that write the object, not the ones the editor still serves", () => {
    rect.set({ locked: true, selectable: false, evented: false });
    const { host } = setup(rect);

    // Deleted, duplicate, cut, nudge and arrange all refuse a locked object, so
    // the fields that write it directly are withheld rather than advertised.
    for (const selector of [
      "[data-yunari-opacity]",
      '[data-yunari-geometry="left"]',
      "[data-yunari-panel-fill]",
    ]) {
      expect(host.querySelector(selector), selector).toBeNull();
    }
    expect(host.textContent).toContain("locked");
  });

  it("republishes when the object is locked from the layer row (vg-148)", () => {
    // vg-148: locking through the layer row sets the flags and fires no
    // selection event, so the column went on offering writing fields the object
    // would refuse until something else happened to re-render it. This drives
    // the real manager over a real canvas — an event the manager never fires
    // cannot reach the column through a stub that does not route one.
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ left: 0, top: 0, width: 40, height: 20 });
    object.set("id", "cpu-card");
    canvas.add(object);
    canvas.setActiveObject(object);

    const host = document.createElement("div");
    createSelectionInspector(host, {
      editor: {
        canvas,
        historyManager: { saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
        cropManager: idleCrop(),
      } as never,
      refreshGlass: vi.fn(),
    });

    expect(host.querySelector("[data-yunari-name]")).not.toBeNull();
    expect(host.textContent).not.toContain(uiCopy.inspectorFields.locked);

    createObjectLockManager(canvas, vi.fn()).lockObject();

    expect(host.textContent).toContain(uiCopy.inspectorFields.locked);
    expect(host.querySelector("[data-yunari-name]")).toBeNull();
    expect(host.querySelector('[data-yunari-geometry="width"]')).toBeNull();
  });

  it("keeps the run editor on a locked object, because nothing refuses it", () => {
    const text = new IText("Hi", { left: 0, top: 0, id: "locked-label" });
    text.set({
      locked: true,
      selectable: false,
      evented: false,
      yunariText: {
        runs: [{ kind: "value", bindingId: "clock-date" }],
      },
    });
    const { host } = setup(text);

    // `#setBindings` writes bindings without reading a lock, and the ordering
    // and grouping actions stay on a bare selection, so hiding the run editor
    // would refuse work the editor actually performs.
    expect(host.querySelector("[data-yunari-runs]")).not.toBeNull();
    expect(host.querySelector("[data-yunari-run-source]")).not.toBeNull();
    expect(host.textContent).toContain("locked");
  });

  it("previews a run's format in the language setLocale hands it", () => {
    // The instant is pinned so the expected word is fixed rather than a guess at
    // which weekday the suite happens to run on.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T15:30:00Z"));

    try {
      const bindings: readonly Binding[] = [
        { id: "clock-date", semanticKey: "date.today", format: "dddd" },
      ];
      const text = new Textbox("", { id: "clock-label" });
      text.set({
        yunariText: { runs: [{ kind: "value", bindingId: "clock-date" }] },
      });
      const { inspector, host } = setup(text, {
        nodeBindings: () => bindings,
      });
      const preview = (): string | null | undefined =>
        host.querySelector<HTMLElement>("[data-yunari-run-format-preview]")
          ?.textContent;

      const instant = instantIn(Date.now());

      // The preview is a reading the paint must agree with, and the inspector is
      // the only thing that spells one for the author. Before any language is
      // pushed, it reads the default.
      expect(preview()).toBe(weekdayWord(instant, "en"));

      inspector.setLocale("ja");

      // `setLocale` re-renders, so the preview the author sees after choosing a
      // language is the one that language produces — not the one from before.
      expect(preview()).toBe(weekdayWord(instant, "ja"));
      expect(preview()).not.toBe(weekdayWord(instant, "en"));
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The arrange actions the column leads with (`vg-463`).
 *
 * The dock carried them and no longer does; the inspector is their one home,
 * and it is the panel of the selection they act on. What this file can prove is
 * the wiring: which selections get the row, that the row sits between the
 * subject and the first section, and that pressing one arranges the objects —
 * the rendered reading of it is the controller's browser pass.
 */
describe("the arrange actions the column leads with", () => {
  const buttons = (host: HTMLElement): readonly HTMLButtonElement[] => [
    ...host.querySelectorAll<HTMLButtonElement>("[data-yunari-arrange-action]"),
  ];

  /** The inspector over a real canvas, the way the shell builds it — the one
   *  stub that can carry an arrange action through to the objects. */
  function onCanvas(canvas: Canvas): {
    readonly host: HTMLElement;
    readonly history: { saveState: ReturnType<typeof vi.fn> };
  } {
    const host = document.createElement("div");
    document.body.append(host);
    const history = { saveState: vi.fn() };
    createSelectionInspector(host, {
      editor: {
        canvas,
        historyManager: history,
        errorManager: { warn: vi.fn(), error: vi.fn() },
        cropManager: idleCrop(),
      } as never,
      refreshGlass: vi.fn(),
    });
    return { host, history };
  }

  it("offers the eight to a multi-selection, and nothing to one object", () => {
    const first = new Rect({ left: 0, top: 0, width: 40, height: 20 });
    const second = new Rect({ left: 100, top: 60, width: 40, height: 20 });

    // One object: no row at all. Eight greyed buttons would be a section
    // standing over a question this selection does not have.
    const alone = setup(first);
    expect(alone.host.querySelector("[data-yunari-arrange-row]")).toBeNull();
    expect(buttons(alone.host)).toHaveLength(0);

    const pair = setup(new ActiveSelection([first, second]));
    expect(pair.host.querySelector("[data-yunari-arrange-row]")).not.toBeNull();
    expect(buttons(pair.host).map((b) => b.getAttribute("aria-label"))).toEqual(
      Object.values(uiCopy.arrangeLabels),
    );
    // Greyed rather than filtered inside the row: an align needs two and lives,
    // a distribute needs three and is drawn disabled.
    const live = (label: string): boolean =>
      buttons(pair.host).find((b) => b.getAttribute("aria-label") === label)
        ?.disabled === false;
    expect(live(uiCopy.arrangeLabels["align-left"])).toBe(true);
    expect(live(uiCopy.arrangeLabels["distribute-x"])).toBe(false);
    expect(live(uiCopy.arrangeLabels["distribute-y"])).toBe(false);
  });

  it("leads the column: under the subject, above the first section", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const first = new Rect({ left: 0, top: 0, width: 40, height: 20 });
    const second = new Rect({ left: 100, top: 60, width: 40, height: 20 });
    canvas.add(first, second);
    const { host } = onCanvas(canvas);

    canvas.setActiveObject(new ActiveSelection([first, second], { canvas }));

    const subject = host.querySelector("[data-yunari-subject-name]")!;
    const row = host.querySelector("[data-yunari-arrange-row]")!;
    const section = host.querySelector("[data-yunari-section]")!;
    const follows = (anchor: Element, later: Element): boolean =>
      (anchor.compareDocumentPosition(later) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;

    expect(follows(subject, row), "the subject leads").toBe(true);
    expect(follows(row, section), "the row is above the sections").toBe(true);

    // **The boundary the lead creates is its own.** `inspector.tsx` closes the
    // subject block with a hairline and `column.tsx` suppresses the first
    // section's rule under it (`vg-466`) — which is right for a column with no
    // lead, and would leave this block sharing a band with the first section's
    // header once one is here. So the lead closes itself, and the read is that
    // the panel has one rule per boundary: the subject's above the lead, the
    // lead's below it, and none of the first section's. jsdom has no cascade, so
    // what is read is the declaration the class names.
    const lead = host.querySelector("[data-yunari-selection-lead]")!;
    expect(lead.classList.contains("border-b"), "the lead closes itself").toBe(
      true,
    );
    expect(
      subject.closest(".border-b"),
      "the subject still owns the rule above the lead",
    ).not.toBeNull();
    expect(
      section.classList.contains("border-t"),
      "the first section draws none of its own",
    ).toBe(false);
  });

  it("arranges the objects when the author presses one", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const first = new Rect({ left: 0, top: 0, width: 40, height: 20 });
    const second = new Rect({ left: 100, top: 60, width: 40, height: 20 });
    canvas.add(first, second);
    const { host, history } = onCanvas(canvas);
    canvas.setActiveObject(new ActiveSelection([first, second], { canvas }));

    // Measured on the **drawn** rect, not on `left`/`top`: joining a selection
    // rewrites those into the selection's own plane, so the properties of two
    // aligned objects are equal for a reason the author cannot see. The rect is
    // what the canvas shows.
    const before = second.getBoundingRect().top;

    await click(
      buttons(host).find(
        (button) =>
          button.getAttribute("aria-label") ===
          uiCopy.arrangeLabels["align-left"],
      )!,
    );

    // The anchor is the selection's first object, so the second lands on its
    // left edge — through the registry's own run, which is `arrange.ts`.
    expect(second.getBoundingRect().left).toBeCloseTo(
      first.getBoundingRect().left,
      6,
    );
    // An align is horizontal: the object the action moved keeps its own height,
    // and its vertical position with it.
    expect(second.getBoundingRect().top).toBeCloseTo(before, 6);
    // And one arrange action is one history entry (§67).
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });
});

describe("the column's sections", () => {
  let rect: Rect;

  beforeEach(() => {
    rect = new Rect({ left: 0, top: 0, width: 40, height: 20 });
  });

  const ids = (host: HTMLElement): (string | undefined)[] =>
    [...host.querySelectorAll<HTMLElement>("[data-yunari-section]")].map(
      (section) => section.dataset["yunariSection"],
    );

  const isOpen = (host: HTMLElement, id: string): boolean =>
    host
      .querySelector(`[data-yunari-section="${id}"] > h2 > button`)
      ?.getAttribute("aria-expanded") === "true";

  const summaryOf = (host: HTMLElement, id: string): HTMLElement =>
    host.querySelector<HTMLElement>(
      `[data-yunari-section="${id}"] > h2 > button`,
    )!;

  it("asks the four questions in order, and opens every one of them", () => {
    const { host } = setup(rect);

    expect(ids(host)).toEqual(["content", "position", "layer", "paint"]);
    // Position was the one section put away, on the reasoning that geometry is
    // set once. An object is usually selected *for* its position, so it opens
    // with the rest (item 13) — and the author may still close what they are
    // not using.
    for (const id of ["content", "position", "layer", "paint"]) {
      expect(isOpen(host, id), id).toBe(true);
    }
  });

  it("says how much the closed Position holds, so collapsed is not hidden", () => {
    const { host } = setup(rect);
    const section = host.querySelector<HTMLElement>(
      '[data-yunari-section="position"]',
    )!;

    // The count is every row the section renders, and a header that could claim
    // more than the section holds is the defect the section control exists to
    // prevent.
    const count = Number(
      section.querySelector("[data-yunari-section-count]")?.textContent,
    );
    // Each field, extra and reveal renders exactly one row element inside the
    // panel, and the panel holds nothing else — there is no separate body
    // container for a row to hide in now.
    const panel = section.querySelector<HTMLElement>(":scope > div")!;
    const rows = panel.childElementCount;
    expect(count).toBe(rows);
    expect(rows).toBeGreaterThan(0);
  });

  it("keeps the disclosure the author chose across a re-publish", () => {
    const { host, inspector } = setup(rect);
    // Position now opens like the rest (item 13), so the arrangement under test
    // is the author's: one closed, one left open.
    act(() => {
      summaryOf(host, "position").click();
    });
    expect(isOpen(host, "position")).toBe(false);
    expect(isOpen(host, "paint")).toBe(true);

    inspector.render();

    // The author's own arrangement, not a fresh default: a re-publish that
    // rebuilt the sections would open Position again and collapse Paint under
    // their hands. React keeps the open state; the projection only says what a
    // fresh section starts as.
    expect(isOpen(host, "position")).toBe(false);
    expect(isOpen(host, "paint")).toBe(true);
  });

  it("keeps the caret in the field being typed into", () => {
    const { host, inspector } = setup(rect);
    const name = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;
    name.focus();
    expect(document.activeElement).toBe(name);

    inspector.render();

    // The field is React's now, so a re-publish updates it in place rather than
    // rebuilding it: the caret is kept by the element surviving, where the
    // imperative body had to put it back into a fresh element.
    const after = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;
    expect(after).toBe(name);
    expect(document.activeElement).toBe(after);
  });

  it("keeps the focus on a control that only toggles", () => {
    const { host, inspector } = setup(rect);
    const glass = host.querySelector<HTMLElement>(
      "[data-yunari-glass-enabled]",
    )!;
    glass.focus();
    expect(document.activeElement).toBe(glass);

    inspector.render();

    // The switch is React's now, so a re-publish updates it in place rather than
    // rebuilding it: focus is kept by the element surviving, the same way the
    // name field keeps its caret. The imperative body deliberately did not
    // restore focus here, because doing so re-opened the glass control's reason
    // popup — but the reason is words in the row now (DESIGN.md §5.3), owned by plan
    // 1's `ControlRow`, so there is no popup left to re-open.
    const after = host.querySelector<HTMLElement>(
      "[data-yunari-glass-enabled]",
    )!;
    expect(after).toBe(glass);
    expect(document.activeElement).toBe(after);
  });

  /**
   * A draft belongs to the object it was typed into.
   *
   * The imperative editor's queued blur was the reported defect: the author
   * typed a name, selected something else, and the blur that followed wrote the
   * abandoned draft where it no longer belonged. React's row identity is what
   * answers it now — a row keyed by field id alone would be reconciled onto the
   * next object still holding the previous one's draft — so each of the four
   * ways the described object can change gets its own case.
   */
  describe("a draft and the object it describes", () => {
    /** Two named rects and a selection a test can move between them. */
    function twoObjects(): {
      readonly a: Rect;
      readonly b: Rect;
      readonly select: (object: FabricObject | undefined) => void;
      readonly inspector: ReturnType<typeof setup>["inspector"];
      readonly host: HTMLElement;
      readonly history: ReturnType<typeof setup>["history"];
    } {
      const a = new Rect({ left: 0, top: 0, width: 40, height: 20 });
      a.set({ id: "obj-1", name: "Panel A" });
      const b = new Rect({ left: 60, top: 0, width: 40, height: 20 });
      b.set({ id: "obj-2", name: "Panel B" });
      let active: FabricObject | undefined = a;
      const built = setup(() => active);
      return {
        a,
        b,
        select: (object) => {
          active = object;
        },
        inspector: built.inspector,
        host: built.host,
        history: built.history,
      };
    }

    /** The draft in the name field, left uncommitted. */
    async function typedName(host: HTMLElement): Promise<HTMLInputElement> {
      const field = host.querySelector<HTMLInputElement>("[data-yunari-name]")!;
      await draft(field, "Typed A");
      return field;
    }

    it("writes nothing when the selection moves to another object", async () => {
      const { a, b, select, inspector, host, history } = twoObjects();
      const field = await typedName(host);

      select(b);
      inspector.render();
      expect(
        host.querySelector<HTMLInputElement>("[data-yunari-name]")?.value,
      ).toBe("Panel B");

      // The blur A's field was queued for now lands on an element that has left
      // the tree. Neither object took the draft.
      await act(async () => {
        field.blur();
      });
      expect(a.get("name")).toBe("Panel A");
      expect(b.get("name")).toBe("Panel B");
      expect(history.saveState).not.toHaveBeenCalled();
    });

    it("writes nothing when the selection is gone", async () => {
      // Deselected and deleted are one path here: the canvas reports no active
      // object either way, so the row leaves the tree the same way. What the
      // draft must not do is reach an object the panel no longer describes.
      const { a, select, inspector, host, history } = twoObjects();
      const field = await typedName(host);

      select(undefined);
      inspector.render();
      expect(host.querySelector("[data-yunari-name]")).toBeNull();

      await act(async () => {
        field.blur();
      });
      expect(a.get("name")).toBe("Panel A");
      expect(history.saveState).not.toHaveBeenCalled();
    });

    it("writes nothing into the object an undo rebuilt under the same id", async () => {
      const { a, select, inspector, host, history } = twoObjects();
      const field = await typedName(host);

      // An undo hands back a *new* object carrying the same id, so an identity
      // taken from the id would reconcile the old row onto it.
      const rebuilt = new Rect({ left: 0, top: 0, width: 40, height: 20 });
      rebuilt.set({ id: a.get("id"), name: "Panel A" });
      select(rebuilt);
      inspector.render();
      expect(
        host.querySelector<HTMLInputElement>("[data-yunari-name]")?.value,
      ).toBe("Panel A");

      await act(async () => {
        field.blur();
      });
      expect(rebuilt.get("name")).toBe("Panel A");
      expect(history.saveState).not.toHaveBeenCalled();
    });

    it("writes nothing when the object is locked between the draft and the blur", async () => {
      const { a, select, inspector, host, history } = twoObjects();
      const field = await typedName(host);

      // A locked object is offered no writing field at all, so the row is gone
      // by the time the blur would have committed.
      a.set("locked", true);
      select(a);
      inspector.render();
      expect(host.querySelector("[data-yunari-name]")).toBeNull();

      await act(async () => {
        field.blur();
      });
      expect(a.get("name")).toBe("Panel A");
      expect(history.saveState).not.toHaveBeenCalled();
    });
  });

  it("renders no header at all for a section with nothing in it", () => {
    const locked = new Rect({ left: 0, top: 0, width: 40, height: 20 });
    locked.set("locked", true);
    const { host } = setup(locked);

    // Every field that writes is withheld, so no question has anything left to
    // ask and none of them stands a header over nothing. **An inspector may be
    // empty**: until item 17 removed the read-only section, a locked object kept
    // one and this column never showed zero sections, so the empty answer is the
    // one §7.4's rule and the removed section together produce. The lead block
    // above the sections still names the lock.
    expect(locked.get("locked")).toBe(true);
    expect(host.querySelector("[data-yunari-locked]")).not.toBeNull();
    expect(host.querySelectorAll("[data-yunari-section]")).toHaveLength(0);
    expect(host.querySelector("[data-yunari-name]")).toBeNull();
  });

  it("puts each field under the question it answers", () => {
    const { host } = setup(rect);
    const inSection = (id: string, selector: string): Element | null =>
      host.querySelector(`[data-yunari-section="${id}"] ${selector}`);

    expect(inSection("content", "[data-yunari-name]")).not.toBeNull();
    expect(
      inSection("position", '[data-yunari-geometry="left"]'),
    ).not.toBeNull();
    expect(
      inSection("position", '[data-yunari-geometry="width"]'),
    ).not.toBeNull();
    expect(inSection("layer", '[data-yunari-geometry="angle"]')).not.toBeNull();
    expect(inSection("layer", "[data-yunari-opacity]")).not.toBeNull();
    expect(inSection("paint", "[data-yunari-panel-fill]")).not.toBeNull();

    // ...and nowhere else: rotation is not a position.
    expect(inSection("position", '[data-yunari-geometry="angle"]')).toBeNull();
    expect(inSection("layer", '[data-yunari-geometry="width"]')).toBeNull();
    // The deliberate bleed toggle left Position with its mark, and the user
    // ruled it out of every surface rather than only the display
    // (`docs/decisions/0069`, `vg-578`). Asserted rather than left to the
    // absence of a symbol, because this row is where it used to be.
    expect(inSection("position", "[data-yunari-bleeds]")).toBeNull();
  });

  it("offers an image both flips under Layer, one press each", async () => {
    const image = new FabricImage("", {
      left: 0,
      top: 0,
      width: 40,
      height: 40,
    });
    const { host, history } = setup(image);
    const flip = (axis: "x" | "y"): HTMLElement | null =>
      host.querySelector<HTMLElement>(
        `[data-yunari-section="layer"] [data-yunari-flip-${axis}]`,
      );

    expect(flip("x")?.getAttribute("aria-checked")).toBe("false");
    expect(flip("y")?.getAttribute("aria-checked")).toBe("false");

    await click(flip("x")!);
    expect(image.flipX).toBe(true);
    await click(flip("y")!);
    expect(image.flipY).toBe(true);
    await click(flip("x")!);
    expect(image.flipX).toBe(false);
    // Three presses, three entries: a flip is one write through the same
    // commit funnel every other object field uses, so one undo step each.
    expect(history.saveState).toHaveBeenCalledTimes(3);
  });

  it("offers flips to an image and to no other kind", () => {
    expect(
      setup(
        new Rect({ left: 0, top: 0, width: 40, height: 20 }),
      ).host.querySelector("[data-yunari-flip-x]"),
    ).toBeNull();
    expect(
      setup(
        new FabricImage("", { left: 0, top: 0, width: 40, height: 40 }),
      ).host.querySelector("[data-yunari-flip-x]"),
    ).not.toBeNull();
  });

  it("is a plan a test can read as data, before anything renders", () => {
    const editor = {
      canvas: canvasWith(rect),
      historyManager: { saveState: vi.fn() },
      errorManager: { warn: vi.fn(), error: vi.fn() },
      cropManager: idleCrop(),
    };
    const sections = perKindColumn(rect, {
      editor: editor as never,
      globals: undefined,
      locale: undefined,
      geometry: {
        read: () => 0,
        write: () => {},
      },
      stillTarget: () => true,
      commit: () => {},
      rerender: () => {},
      refreshGlass: () => {},
      nodeBindings: undefined,
      onNodeBindingsChange: undefined,
      sampleSource: undefined,
    });

    expect(sections.map((section) => section.id)).toEqual([
      "content",
      "position",
      "layer",
      "paint",
    ]);
    // Every one of them, Position included — no section starts closed.
    expect(
      sections
        .filter((section) => section.defaultOpen)
        .map((section) => section.id),
    ).toEqual(["content", "position", "layer", "paint"]);
    for (const section of sections) {
      // The count is every row the section renders — its fields and its extras
      // — and the header's count has to agree.
      expect(section.count, section.id).toBe(
        section.fields.length + section.extras.length,
      );
    }
  });

  it("mounts a chart's own fields in the chart's own column", () => {
    // The seam the Data tab used to be. A chart's settings and bindings are
    // written by the chart manager, which hands the column the values to render
    // — in the Content and Paint sections, where the author already is.
    const chart = chartOf("gauge", defaultGaugeSettings);
    const target: ChartFieldTarget = {
      id: "cpu-gauge",
      content: { family: "gauge", settings: defaultGaugeSettings },
      bindings: [{ id: "b1", semanticKey: "cpu.load" }],
    };
    // Real values from the owner's own projection, so an extra that arrived
    // emptied would fail here rather than passing a shape check.
    const content = chartContentView(target);
    const paint = chartPaintView(target, undefined);
    const chartFields: ChartFieldsPort = {
      content: () => content,
      paint: () => paint,
    };
    const sections = perKindColumn(chart, {
      editor: {
        canvas: canvasWith(chart),
        historyManager: { saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
        cropManager: idleCrop(),
      } as never,
      globals: undefined,
      locale: undefined,
      geometry: {
        read: () => 0,
        write: () => {},
      },
      stillTarget: () => true,
      commit: () => {},
      rerender: () => {},
      refreshGlass: () => {},
      nodeBindings: undefined,
      onNodeBindingsChange: undefined,
      sampleSource: undefined,
      chartFields,
    });
    const section = (name: string) => {
      const found = sections.find((candidate) => candidate.id === name);
      if (found === undefined) throw new Error(`no ${name} section`);
      return found;
    };
    const kinds = (name: string): string[] =>
      section(name)
        .extras.filter(rendersExtra)
        .map((extra) => extra.kind);

    expect(kinds("content")).toEqual(["chartContent"]);
    expect(kinds("paint")).toEqual(["chartPaint"]);
    // The payload is the owner's own reading, not a reconstruction of it.
    expect(section("content").extras[0]).toEqual({
      kind: "chartContent",
      content,
    });
    expect(section("paint").extras[0]).toEqual({ kind: "chartPaint", paint });
    // Nowhere else: a chart's paint is not a content field, and the count over
    // each section is what tells the two apart when both are mounted. The
    // chart's own extra counts once, however many controls it carries.
    for (const name of ["content", "paint"]) {
      expect(section(name).count, name).toBe(section(name).fields.length + 1);
    }
  });
});

describe("the size of a text object", () => {
  /**
   * Measured on the surface while placing the first card of the rebuild: a
   * 24-400 caption asked for a 220 × 40 box came back at `scaleX 3.448` and
   * `scaleY 0.439` — the type stretched to three and a half times its width
   * and squashed to under half its height. The field says Size; on a `Textbox`
   * the width *is* the box the text wraps inside, so there was nothing to
   * scale.
   */
  function caption(): Textbox {
    const text = new Textbox("AMD Ryzen 7 7800X3D", {
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      fontSize: 32,
    });
    text.set({
      yunariText: {
        runs: [
          {
            kind: "literal",
            text: "AMD Ryzen 7 7800X3D",
            typePreset: "typePresets.body",
          },
        ],
      },
    });
    return text;
  }

  it("writes the authored box, and leaves the type at its preset's size", async () => {
    const text = caption();
    const { host, history } = setup(text);

    const width = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="width"]',
    )!;
    await edit(width, "220");
    const height = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="height"]',
    )!;
    await edit(height, "40");

    const authored = text.get("yunariText") as {
      box: { width: number; height: number };
    };
    expect(authored.box).toEqual({ width: 220, height: 40 });
    expect(text.scaleX).toBe(1);
    expect(text.scaleY).toBe(1);
    expect(text.fontSize).toBe(32);
    // One committed edit each, matching every other field here.
    expect(history.saveState).toHaveBeenCalledTimes(2);
  });

  it("gives a whole box when only one Size field is filled in", async () => {
    // An inserted caption has no box yet: its width is Fabric's measurement
    // until an author types one. Writing the height alone used to produce
    // `{ height }` with no width, and the next text change multiplied an
    // undefined width by the scale — the object lost its width and stopped
    // producing a bounding rect at all.
    const text = caption();
    const measured = text.width;
    const { host } = setup(text);

    const height = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="height"]',
    )!;
    await edit(height, "40");

    const authored = text.get("yunariText") as {
      box: { width: number; height: number };
    };
    expect(authored.box.height).toBe(40);
    expect(authored.box.width).toBe(measured);
    // The other half: the box is a number, not the `undefined` that made the
    // width unreadable.
    expect(Number.isFinite(authored.box.width)).toBe(true);
  });

  /** The number a Size half shows, as the author reads it. */
  const shown = (
    root: HTMLElement,
    key: "width" | "height",
  ): string | undefined =>
    root.querySelector<HTMLInputElement>(`[data-yunari-geometry="${key}"]`)
      ?.value;

  it("reads the object's own edge, not the box it was told", () => {
    // vg-109, ruled: the Size readout is a probe for what the canvas has, so it
    // reads the object's own measured edge — where the object has been placed
    // and what it measures — rather than echoing the `yunariText.box` beside
    // it. Here the box says 300 × 90 and the object measures something else,
    // and the field follows the object.
    const text = caption();
    text.set("yunariText", {
      ...(text.get("yunariText") as Record<string, unknown>),
      box: { width: 300, height: 90 },
    });
    const { host } = setup(text);

    expect(text.width).not.toBe(300);
    expect(shown(host, "width")).toBe(
      String(Math.round(text.width * text.scaleX)),
    );
    expect(shown(host, "height")).toBe(
      String(Math.round(text.height * text.scaleY)),
    );
  });

  it("still scales a shape, whose width is a size rather than a box", async () => {
    // The same field, the other kind of object: a `Rect`'s width is a natural
    // size, and scaling is how it changes.
    const panel = new Rect({ left: 0, top: 0, width: 360, height: 200 });
    const { host } = setup(panel);

    const width = host.querySelector<HTMLInputElement>(
      '[data-yunari-geometry="width"]',
    )!;
    await edit(width, "180");

    expect(panel.scaleX).toBeCloseTo(0.5, 6);
    expect(panel.get("yunariText")).toBeUndefined();
  });

  /**
   * A text object whose box and whose own edge are different numbers, which is
   * what the ruling above is about: `yunariText.box` is stored **unscaled**, so
   * a scaled text object draws a box larger than the box says. Measured on the
   * running editor: a 140 × 27.12 box at `scaleY 2` read **27** in the H field
   * and drew an edge of 54.24.
   */
  function scaledCaption(): Textbox {
    const text = caption();
    const box = { width: 140, height: 27 };
    text.set("yunariText", {
      ...(text.get("yunariText") as Record<string, unknown>),
      box,
    });
    text.set({ scaleX: 2, scaleY: 2 });
    // Where the text pass leaves the object's own edges: `refreshLayout` hands
    // `assertBox` the authored box in parent space (`authoredBox` is `boxFrom`,
    // so the stored number times the scale) and `assertBox` divides that scale
    // straight back out, so the object's own `width`/`height` end at the stored
    // number — which is why the field, reading `width * scaleX`, shows twice it.
    // Assigned rather than `set` here because a `set` re-enters
    // `initDimensions` and Fabric re-derives the height from the wrapped text;
    // left at Fabric's measurement, this would be asserting jsdom's font metrics
    // rather than the inspector.
    text.width = box.width;
    text.height = box.height;
    return text;
  }

  it("reads the drawn box on a scaled text object, where the box is a different number", () => {
    // The measured disagreement the row was re-measured on: the field said 27
    // where the canvas drew 54, so a reader comparing the two had to work out
    // which was wrong before either could be fixed. It reads the drawn number
    // now.
    const { host } = setup(scaledCaption());

    expect(shown(host, "width")).toBe("280");
    expect(shown(host, "height")).toBe("54");
  });

  it("writes the Size it shows, in the units it shows it in", async () => {
    // The other half of reading in drawn units: the write divides by the same
    // scale the read multiplies by, because `yunariText.box` is stored
    // unscaled — the unit a dragged handle writes. `box × scale` is what the
    // object draws, since `assertBox` puts the box onto the object's own edges
    // and the scale goes back on over them, so the number typed has to be the
    // number drawn. Without the divide this was the one arm of the control
    // whose shown number could not be typed back: it read 280, a typed 300 drew
    // 600, and the field then showed 600 — every edit multiplied the object by
    // its own scale (vg-109).
    const text = scaledCaption();
    const box = (): { readonly width: number; readonly height: number } =>
      (text.get("yunariText") as { box: { width: number; height: number } })
        .box;
    const half = (key: "width" | "height"): HTMLInputElement =>
      host.querySelector<HTMLInputElement>(`[data-yunari-geometry="${key}"]`)!;

    // Typing the number the field *shows* is not this case: `control-text.tsx`
    // skips an unchanged draft (`next === value`), so a retype never reaches
    // the write at all — measured, with the field showing 280 and the box left
    // at 140 either side of it. What a write has to hold is the unit: whatever
    // is typed, the object draws it and the field reads it back.
    const { host, inspector } = setup(text);
    expect(shown(host, "width")).toBe("280");
    await edit(half("width"), "300");
    expect(box().width * text.scaleX, "W draws the number typed").toBe(300);

    // What the text pass does next, done by hand because jsdom has no canvas to
    // run it: `assertBox` puts the box onto the object's own edges, and the
    // field then reads back the number that was typed.
    text.width = box().width;
    inspector.render();
    expect(shown(host, "width"), "W reads the number back").toBe("300");

    expect(shown(host, "height")).toBe("54");
    await edit(half("height"), "60");
    expect(box().height * text.scaleY, "H draws the number typed").toBe(60);
  });

  it("reads the numbers back where the object's edges carry the box", () => {
    // The state the text pass leaves every text object in: `assertBox` puts the
    // box onto the object's own edges, so the readout agrees with the box it
    // just wrote. Nothing on screen moves for a document in this state.
    const text = caption();
    text.set("yunariText", {
      ...(text.get("yunariText") as Record<string, unknown>),
      box: { width: text.width, height: text.height },
    });
    const { host } = setup(text);

    expect(shown(host, "width")).toBe(String(Math.round(text.width)));
    expect(shown(host, "height")).toBe(String(Math.round(text.height)));
  });

  it("reads a shape's scaled size, which is the same rule", () => {
    const panel = new Rect({ left: 0, top: 0, width: 360, height: 200 });
    panel.set({ scaleX: 2, scaleY: 2 });
    const { host } = setup(panel);

    // A shape has no box: its `width` is a size and the scale is part of it, so
    // this is the number the canvas draws — which the readout has always read.
    expect(shown(host, "width")).toBe("720");
  });
});

describe("the column a kind gets", () => {
  /** A shape that carries a paint reference, so a container built from it has
      something for its own appearance question to read. */
  function paintedRect(id: string): Rect {
    const rect = new Rect({ left: 0, top: 0, width: 40, height: 20, id });
    rect.set("yunariPaint", { fill: "palette.ink" });
    return rect;
  }

  /** A text object with authored runs: the only kind that has typography. */
  function textBox(): Textbox {
    const text = new Textbox("Hi", {
      left: 0,
      top: 0,
      width: 40,
      id: "label-1",
    });
    text.set("yunariText", {
      runs: [{ kind: "literal", text: "Hi", typePreset: "typePresets.body" }],
    });
    return text;
  }

  /**
   * One live example per kind, in the brief's own terms: a `Wedge`, a text box,
   * a chart, an image, a group, and a selection spanning two kinds. The list is
   * the driver — a kind added to `SELECTION_KINDS` arrives here without an
   * example and fails to compile, rather than passing unnoticed. The background
   * is not one of these: it is no Fabric object, and `background-column.test.ts`
   * describes it.
   */
  const EXAMPLE: Readonly<
    Record<Exclude<SelectionKind, "background">, () => FabricObject>
  > = {
    shape: () =>
      new Wedge({
        left: 0,
        top: 0,
        radius: 20,
        startAngle: 0,
        endAngle: 90,
      }),
    text: () => textBox(),
    chart: () => chartOf("gauge", defaultGaugeSettings),
    image: () =>
      new FabricImage("", { left: 0, top: 0, width: 40, height: 40 }),
    group: () => new Group([paintedRect("panel-1"), textBox()]),
    activeSelection: () =>
      new ActiveSelection([paintedRect("panel-1"), textBox()]),
  };

  /**
   * Everything each kind rendered **before** this plan, read off the pre-change
   * source at the plan-3 base — `git show 190dc1a4:` of
   * `selection-inspector/per-kind-column.ts` and the builders it calls
   * (`appearance.ts`, `panel.ts`, `glass.ts`, `crop.ts`, `bleed.ts`) — rather
   * than off the column, which would only restate whatever the column now does
   * and would agree with a bug.
   *
   * The gates are `perKindColumn`'s own: a locked object loses Content's name
   * and all of Position, Layer and Paint.
   *
   * **The glass control left this shared floor with `vg-465`.** It used to be
   * offered for every unlocked selection, because its refusal is why it was
   * never absent; it is now offered only to a subject the treatment reaches, so
   * it belongs to `shape`'s own row — and the reason a subject that cannot carry
   * it is given is a subject note (`glass.dom.test.ts`), not a section row.
   *
   * `shape`'s reference is the `Wedge`, so the corner radius is absent on
   * purpose and asserted separately: `rx` is a `Rect`'s property and no other
   * shape reads it.
   *
   * **This table is the *shared* names — the ones every kind's column answers
   * with — and it is not the whole parity inventory.** A kind's own fields are
   * owned, and tested, by the domain that renders them; the union of the
   * instruments carrying this plan's claim is:
   *
   * - this file — the common hooks, per kind and for a locked object;
   * - `crop.dom.test.ts`, `runs.dom.test.ts`, `panel.dom.test.ts`,
   *   `glass.dom.test.ts`, `artboard-panel.dom.test.ts` — the per-domain fields
   *   (crop handles, run rows, the paint and radius wells, the glass toggle and
   *   blur), each asserted where its owner lives;
   * - `tests/e2e/*.spec.ts` — the same hooks again against a built bundle, which
   *   is what proves the surface renders them, not only that jsdom's tree does.
   *
   * So the count here is deliberately the shared floor, not the ceiling — and
   * the figures are exact so the parts sum to the whole. This table names **16**
   * distinct hooks: three in `EVERY_OBJECT` (`geometry`'s five selectors are one
   * name), six added by `shape`, six by `text`, one by `image`. It named 19 while
   * the read-only section stood, and item 17 removed the two that were its:
   * `data-yunari-resolution` (`EVERY_OBJECT` and `text`'s Type-preset row) and
   * `data-yunari-reveal-type-presets` (`text`). It named 17 until Task 25.7,
   * which removed `data-yunari-bleeds` from `EVERY_OBJECT` with the deliberate
   * bleed control (`docs/decisions/0069`). The pre-plan inspector at
   * `190dc1a4` rendered **46** distinct `data-yunari-*` names. The census
   * (`git grep -oh 'data-yunari-[a-zA-Z-]*' 190dc1a4 --
   * src/web/packages/editor/src/selection-inspector | sort -u | wc -l`) prints
   * 47 — one high: a docblock at `190dc1a4:selection-inspector/index.ts:230`
   * quotes the bare prefix `data-yunari-`, which the pattern counts as a name.
   * So the remaining **30** are 27 carried by the per-domain tests and the e2e
   * specs and those **3** the product no longer renders at all. Reading the 16 as
   * the inventory would understate the coverage by 30.
   */
  const EVERY_OBJECT: readonly string[] = [
    "[data-yunari-name]",
    '[data-yunari-geometry="left"]',
    '[data-yunari-geometry="top"]',
    '[data-yunari-geometry="width"]',
    '[data-yunari-geometry="height"]',
    '[data-yunari-geometry="angle"]',
    "[data-yunari-opacity]",
  ];

  const PRE_PLAN: Readonly<
    Record<Exclude<SelectionKind, "background">, readonly string[]>
  > = {
    shape: [
      ...EVERY_OBJECT,
      // This kind's row alone: a `Wedge` is a region, so the treatment reaches
      // it (`vg-465`).
      "[data-yunari-glass-enabled]",
      "[data-yunari-panel-fill]",
      "[data-yunari-panel-stroke]",
      "[data-yunari-panel-border]",
      "[data-yunari-panel-shadow]",
      '[data-yunari-shape-angle="startAngle"]',
      '[data-yunari-shape-angle="endAngle"]',
    ],
    text: [
      ...EVERY_OBJECT,
      "[data-yunari-runs]",
      "[data-yunari-text-align]",
      "[data-yunari-text-vertical-align]",
      "[data-yunari-text-wrap]",
      "[data-yunari-text-overflow]",
      "[data-yunari-run-source]",
    ],
    chart: [...EVERY_OBJECT],
    image: [...EVERY_OBJECT, "[data-yunari-crop]"],
    group: [...EVERY_OBJECT],
    activeSelection: [...EVERY_OBJECT],
  };

  it.each([...SELECTION_KINDS])(
    "answers a %s with a column rather than an empty one",
    (kind) => {
      const { host } = setup(EXAMPLE[kind]());

      // Not "has the fields I expected". The defect this pins is a kind that
      // reaches the column with no rule and renders nothing at all — the
      // original unreachability defect with a new cause — so the assertion is
      // that the column answered with something.
      expect(
        host.querySelectorAll("[data-yunari-section]").length,
        kind,
      ).toBeGreaterThan(0);
      expect(
        host.querySelectorAll(
          "[data-yunari-section] input, [data-yunari-section] select, [data-yunari-section] button",
        ).length,
        kind,
      ).toBeGreaterThan(0);
    },
  );

  it.each([...SELECTION_KINDS])(
    "keeps every field a %s had before the column was per-kind",
    (kind) => {
      const { host } = setup(EXAMPLE[kind]());

      for (const selector of PRE_PLAN[kind]) {
        expect(
          host.querySelector(selector),
          `${kind}: ${selector}`,
        ).not.toBeNull();
      }
    },
  );

  it.each([...SELECTION_KINDS])(
    "reads its %s example as that kind and no other",
    (kind) => {
      // The two containers share a class — Fabric's `ActiveSelection` *is* a
      // `Group` — so this is what would catch a dispatch that named the parent
      // first and described a multi-selection as one object.
      expect(selectionKindOf(EXAMPLE[kind]())).toBe(kind);
    },
  );

  it("answers a locked object rather than standing a header over nothing", () => {
    const locked = new Rect({
      left: 0,
      top: 0,
      width: 40,
      height: 20,
      locked: true,
    });
    const { host } = setup(locked);

    // Every field that writes is withheld, so nothing is left to render and
    // the column stands no header over it.
    expect(host.querySelectorAll("[data-yunari-section]")).toHaveLength(0);
    expect(host.querySelector("[data-yunari-name]")).toBeNull();
  });

  it("keeps a rectangle's corner radius, which no other shape reads", () => {
    const { host } = setup(
      new Rect({ left: 0, top: 0, width: 40, height: 20 }),
    );

    // The radius is a `Rect` property. A column that answered every shape with
    // the same fields would offer it to a `Wedge` and read back `NaN`.
    expect(host.querySelector("[data-yunari-panel-radius]")).not.toBeNull();
    expect(
      setup(EXAMPLE.shape()).host.querySelector("[data-yunari-panel-radius]"),
    ).toBeNull();
  });

  it.each([
    [
      "a Polygon",
      () =>
        new Polygon([new Point(0, -20), new Point(20, 20), new Point(-20, 20)]),
      "[data-yunari-shape-sides]",
    ],
    [
      "a Polyline",
      () => new Polyline([new Point(0, 0), new Point(20, 20)]),
      "[data-yunari-shape-points]",
    ],
    ["a Line", () => new Line([0, 0, 20, 20]), "[data-yunari-shape-line]"],
    [
      "a Path",
      () => new Path("M 0 0 L 20 20 L 40 0"),
      "[data-yunari-shape-path]",
    ],
  ])(
    "keeps %s's own geometry, which no other shape has",
    (_name, make, selector) => {
      const { host } = setup(make());

      // The general W/H pair belongs to every shape; these numbers belong to one
      // kind each. A per-kind column that answered every shape the same way
      // would be the "lesser selection" this task exists to prevent.
      expect(host.querySelector(selector)).not.toBeNull();
    },
  );

  describe("a container", () => {
    /** The two kinds whose appearance is their children's. */
    const CONTAINERS: readonly (readonly [
      SelectionKind,
      () => FabricObject,
    ])[] = [
      ["group", EXAMPLE.group],
      ["activeSelection", EXAMPLE.activeSelection],
    ];

    it.each(CONTAINERS)(
      "shows bounds for a %s, and not the questions it lacks",
      (_kind, make) => {
        const { host } = setup(make());

        // Bounds: the same Position pair every other object gets, at the same
        // density — a group is not a lesser selection.
        expect(
          host.querySelector('[data-yunari-geometry="width"]'),
        ).not.toBeNull();
        expect(
          host.querySelector('[data-yunari-geometry="left"]'),
        ).not.toBeNull();

        // **The children's appearance is no longer read here.** That line was
        // the read-only section's, and item 17 removed it: a container's ink is
        // now visible only on the children it belongs to, which is the surface
        // the line was reading in the first place. What is left for this kind is
        // its own bounds and the questions it genuinely does not have, which is
        // what
        // "not a lesser selection" means for a kind that lacks them: nothing is
        // shown, rather than a control that would accept an edit and apply none.
        for (const absent of [
          "[data-yunari-panel-fill]",
          "[data-yunari-panel-stroke]",
          "[data-yunari-crop]",
          "[data-yunari-runs]",
          "[data-yunari-text-align]",
        ]) {
          expect(host.querySelector(absent), absent).toBeNull();
        }
      },
    );

    it.each(CONTAINERS)(
      "offers a %s no crop, and no bleed toggle",
      (_kind, make) => {
        const { host } = setup(make());

        // A crop is about an image's own frame, and a container has none — a row
        // that offered one would write a clip nothing there can hold.
        expect(host.querySelector("[data-yunari-crop]")).toBeNull();
        // The toggle used to be offered for every selection, containers included,
        // because every object can overhang. Nothing is marked any more
        // (`docs/decisions/0069`).
        expect(host.querySelector("[data-yunari-bleeds]")).toBeNull();
      },
    );
  });
});
