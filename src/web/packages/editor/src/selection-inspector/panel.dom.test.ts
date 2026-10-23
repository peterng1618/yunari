// @vitest-environment jsdom
import { YUNARI_PAINT_PROPERTY } from "@yunari/scene-fabric";
import {
  Circle,
  Ellipse,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Shadow,
  Textbox,
  Triangle,
} from "fabric/es";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNewShape } from "../new-object-defaults.js";
import { uiCopy } from "../ui-copy.js";
import { supportsGlassControl } from "./glass.js";
import { idleCrop } from "./idle-crop.test-stage.js";
import { createSelectionInspector, type SelectionInspector } from "./index.js";
import { writePanelField, writeShapeGeometryField } from "./panel.js";
// The shared React drivers: a converted field is a plan-1 control, so a raw
// `change` event no longer commits it — the picker is opened and an entry
// clicked, and a number is typed through React's own value tracker.
import { choose, flush, optionsOf, slide } from "./runs.test-stage.js";

/**
 * React only flushes work scheduled inside `act` when it has been told it is in
 * a test; without this, the draft a plan-1 control holds lands after the blur
 * that should have committed it.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Every `setup` attaches its host so a control can hold focus. The body is
// settled and then emptied between cases: `flush` lets a plan-1 select close
// its portal through React before the wipe detaches it, and emptying stops a
// stale popup's options from being found by the next case's global query.
// Unmounting first is what makes that deterministic: a portal closed after the
// wipe removes a node from a container that no longer holds it.
let live: SelectionInspector | undefined;
afterEach(async () => {
  live?.destroy();
  live = undefined;
  await flush();
  document.body.replaceChildren();
});

/** A palette with a solid surface, a solid content token and a gradient, so a
 * control that must refuse a gradient is offered one to refuse. */
const globals = {
  palette: {
    none: {
      name: "None",
      value: { kind: "solid", color: "transparent" },
    },
    background: {
      name: "Background",
      value: { kind: "solid", color: "#0c0e13" },
    },
    text: { name: "Text", value: { kind: "solid", color: "#ecf5ff" } },
    scene: {
      name: "Scene",
      value: {
        kind: "gradient",
        angle: 90,
        stops: [
          { offset: 0, color: "#355473" },
          { offset: 1, color: "#07111d" },
        ],
      },
    },
  },
} as never;

/** `others` is what else the canvas holds — the selection is `active`, and the
 *  paint pass is whole-canvas, so an edit to one object re-resolves all of
 *  them. That is why the shape of the *rest* of the scene decides whether an
 *  inspector edit is silent. */
function setup(active: unknown, others: readonly unknown[] = []) {
  const host = document.createElement("div");
  // Attached: a plan-1 control commits on blur, and jsdom fires a blur only for
  // an element that can hold focus — nothing is focusable while it is detached.
  document.body.append(host);
  const history = { saveState: vi.fn() };
  const editor = {
    canvas: {
      getActiveObject: () => active,
      getObjects: () =>
        active === undefined ? [...others] : [active, ...others],
      requestRenderAll: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
    historyManager: history,
    errorManager: { warn: vi.fn(), error: vi.fn() },
    cropManager: idleCrop(),
  };
  const inspector = createSelectionInspector(host, {
    editor: editor as never,
    globals,
    refreshGlass: vi.fn(),
  });
  live = inspector;
  const field = <T extends HTMLElement>(selector: string): T =>
    host.querySelector<T>(selector)!;
  return { host, history, editor, inspector, field };
}

function panel(): Rect {
  return new Rect({ id: "panel", left: 0, top: 0, width: 360, height: 200 });
}

/**
 * A draft in a plan-1 control, as React sees one. A converted field is a plan-1
 * control that holds its own draft and commits on blur, so it has to be driven
 * the way a person does — through the prototype's setter, because React
 * installs a value tracker that suppresses a plain assignment, then off the
 * field.
 */
async function edit(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(field) as HTMLInputElement,
      "value",
    )?.set;
    if (setter === undefined) field.value = value;
    else setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Its own turn: a blur in the same turn as the draft reads it before React
  // has applied it.
  await act(async () => {
    field.focus();
    field.blur();
  });
}

/** Authored placement, as a value rather than a fresh literal: Fabric infers
    its options type from one, and the inferred type rejects the `id`. */
const PLACED = {
  id: "shape",
  left: 0,
  top: 0,
  originX: "left",
  originY: "top",
} as const;

const CORNERS = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 50, y: 100 },
] as const;

/** Every primitive the Add pane can insert, as a live selection. */
const SHAPES = [
  [
    "rect",
    () => new Rect({ ...PLACED, width: 360, height: 200, rx: 10, ry: 10 }),
  ],
  ["circle", () => new Circle({ ...PLACED, radius: 100 })],
  ["ellipse", () => new Ellipse({ ...PLACED, rx: 180, ry: 100 })],
  ["triangle", () => new Triangle({ ...PLACED, width: 360, height: 200 })],
  ["polygon", () => new Polygon([...CORNERS], PLACED)],
  ["polyline", () => new Polyline([...CORNERS], PLACED)],
  ["line", () => new Line([0, 0, 100, 50], PLACED)],
  ["path", () => new Path("M 0 0 L 100 0 L 0 50 Z", PLACED)],
  ["arc", () => createNewShape("arc", globals, "arc", { left: 0, top: 0 })],
  [
    "wedge",
    () => createNewShape("wedge", globals, "wedge", { left: 0, top: 0 }),
  ],
] as const;
describe("panel fields in the selection inspector", () => {
  it("offers fill, stroke, border width and corner radius for a panel", () => {
    const rect = panel();
    const { host, field } = setup(rect);
    // Non-vacuous: the selection must actually be a rectangle, or a gate that
    // refuses everything would satisfy the field assertions below.
    expect(rect).toBeInstanceOf(Rect);
    expect(host.querySelector("[data-yunari-panel-fill]")).not.toBeNull();
    expect(host.querySelector("[data-yunari-panel-stroke]")).not.toBeNull();
    // A bounded pixel measure is a slider whose bound is the panel's own drawn
    // box — a border can be as wide as the object's smaller edge, a corner no
    // more than half of it (vg-478) — and the well beside the track is the
    // typed route, a text input that takes a decimal rather than a
    // native `<input type=number>`.
    const border = field<HTMLInputElement>("[data-yunari-panel-border]");
    expect(border.type).toBe("range");
    expect(border.min).toBe("0");
    expect(border.max).toBe("200");
    const radius = field<HTMLInputElement>("[data-yunari-panel-radius]");
    expect(radius.type).toBe("range");
    expect(radius.max).toBe("100");
    for (const selector of [
      "[data-yunari-panel-border-well]",
      "[data-yunari-panel-radius-well]",
    ]) {
      expect(field<HTMLInputElement>(selector).inputMode, selector).toBe(
        "decimal",
      );
    }
  });

  it("names every panel control", () => {
    const rect = panel();
    rect.set({ shadow: new Shadow({ color: "#ecf5ff", blur: 8, offsetY: 4 }) });
    const { host } = setup(rect);
    for (const selector of [
      "[data-yunari-panel-fill]",
      "[data-yunari-panel-stroke]",
      "[data-yunari-panel-border]",
      "[data-yunari-panel-radius]",
      "[data-yunari-panel-shadow]",
      "[data-yunari-panel-shadow-blur]",
      "[data-yunari-panel-shadow-offset]",
    ]) {
      const control = host.querySelector<HTMLElement>(selector)!;
      // A row's label is a `<label for>` where the control is labelable and the
      // row's own `<span>` where the control names itself by it — which is what
      // a slider does, so the name is read the way an assistive technology
      // resolves it: the `<label for>` first, then `aria-labelledby`.
      const named = (control.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      const name =
        named === ""
          ? (host.querySelector<HTMLLabelElement>(`label[for="${control.id}"]`)
              ?.textContent ?? control.closest("label")?.textContent)
          : named;
      expect(name, selector).toBeTruthy();
    }
  });

  it("carries the track-and-well pair on every bounded panel number", () => {
    const rect = panel();
    rect.set({ shadow: new Shadow({ color: "#ecf5ff", blur: 8, offsetY: 4 }) });
    const { host } = setup(rect);

    // The census, not the five fields the finding named: every bounded number
    // the panel offers is a slider with a typeable well beside it, because a
    // rule applied to some of them is the defect this sweep ends.
    for (const hook of [
      "data-yunari-panel-border",
      "data-yunari-panel-radius",
      "data-yunari-panel-shadow-blur",
    ]) {
      const track = host.querySelector<HTMLInputElement>(`[${hook}]`)!;
      expect(track.type, hook).toBe("range");
      expect(track.max, hook).not.toBe("");
      expect(
        host.querySelector(`[${hook}-well]`),
        `${hook}: no typed route`,
      ).not.toBeNull();
    }

    // And the one that is deliberately typed-only: Fabric's offsetY is
    // unbounded, so a slider would offer a range nothing honours.
    const offset = host.querySelector<HTMLInputElement>(
      "[data-yunari-panel-shadow-offset]",
    )!;
    expect(offset.type).toBe("text");
    expect(
      host.querySelector("[data-yunari-panel-shadow-offset-well]"),
    ).toBeNull();
  });

  it("writes a chosen fill token onto the object and its palette reference", async () => {
    const rect = panel();
    const { host, history } = setup(rect);

    await choose(host, "data-yunari-panel-fill", "Text");

    // The resolved paint and the authored reference both move, so the panel
    // still follows the token after the next palette edit.
    expect(rect.fill).toBe("#ecf5ff");
    expect(rect.get(YUNARI_PAINT_PROPERTY)).toEqual({ fill: "palette.text" });
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("says so when an inspector edit refuses an arc elsewhere in the scene", async () => {
    // The pass this control runs is **whole-canvas**: it walks every object, so
    // editing a panel's fill re-refuses an arc on the far side of the scene.
    // It used to pass no reporter at all, so an author watching a figure
    // disappear because they had recoloured something else was told nothing.
    const arc = createNewShape("arc", globals, "arc", { left: 0, top: 0 });
    arc.set({ fill: "#ecf5ff" });
    arc.set(YUNARI_PAINT_PROPERTY, { fill: "palette.text" });
    const rect = panel();
    const { host, editor } = setup(rect, [arc]);

    // Non-vacuous: the arc is one that refuses, so a reporter wired to nothing
    // could not satisfy this.
    expect(arc.fill, "the arc starts filled").toBe("#ecf5ff");

    await choose(host, "data-yunari-panel-fill", "Text");

    expect(arc.fill, "the arc's fill is withheld").toBe("");
    expect(
      editor.errorManager.warn,
      "and the author is told the shell's own way",
    ).toHaveBeenCalledWith("paint", expect.stringMatching(/arc/i));
  });

  it("keeps the other references when one paint changes", async () => {
    const rect = panel();
    rect.set({
      [YUNARI_PAINT_PROPERTY]: {
        fill: "palette.background",
        stroke: "palette.text",
        shadowColor: "palette.text",
      },
      shadow: new Shadow({ color: "#ecf5ff", blur: 8 }),
    });
    const { host } = setup(rect);

    await choose(host, "data-yunari-panel-fill", "Text");

    // Palette identity is per property: choosing a fill must not silently
    // re-point the border or the shadow an author already set.
    expect(rect.get(YUNARI_PAINT_PROPERTY)).toEqual({
      fill: "palette.text",
      stroke: "palette.text",
      shadowColor: "palette.text",
    });
  });

  it("clears the fill and its reference when the author picks none", async () => {
    const rect = panel();
    rect.set({
      fill: "#0c0e13",
      [YUNARI_PAINT_PROPERTY]: { fill: "palette.background" },
    });
    const { host } = setup(rect);

    await choose(host, "data-yunari-panel-fill", uiCopy.inspectorFields.notSet);

    expect(rect.fill).toBe("");
    expect(rect.get(YUNARI_PAINT_PROPERTY)).toEqual({});
  });

  it("sets the corner radius on both axes in one committed edit", async () => {
    const rect = panel();
    const { history, field } = setup(rect);

    await edit(field<HTMLInputElement>("[data-yunari-panel-radius]"), "24");

    expect(rect.get("rx")).toBe(24);
    expect(rect.get("ry")).toBe(24);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("bounds the corner radius by half the box Fabric draws it in", async () => {
    // `vg-478`: Fabric draws `Math.min(rx, w / 2)` (`Rect.ts`), so a stored
    // radius past half the smaller drawn dimension is a field claiming a corner
    // the canvas never draws — which is what the author saw as a radius that
    // stopped having any effect. The bound is read from the object's own drawn
    // box rather than written here, so a resized panel re-bounds its own field.
    const rect = panel(); // 360 × 200, so the smaller edge is 200
    const { editor, field } = setup(rect);
    const track = field<HTMLInputElement>("[data-yunari-panel-radius]");
    expect(track.max).toBe("100");

    // A draft past the bound is kept with its reason rather than clamped (§5),
    // which is the rule every other bounded number in the column keeps.
    rect.set({ rx: 8, ry: 8 });
    const well = field<HTMLInputElement>("[data-yunari-panel-radius-well]");
    await edit(well, "240");
    expect(rect.get("rx")).toBe(8);
    expect(
      document.getElementById(`${well.id}-invalid`)?.textContent?.trim(),
    ).toBe("at most 100");

    // And a commit that reached the writer without the control lands on the
    // bound rather than storing a radius nothing renders.
    expect(
      writePanelField(
        rect,
        { editor: editor as never, globals: globals as never },
        "panel-radius",
        240,
      ),
    ).toBe(true);
    expect(rect.get("rx")).toBe(100);
    expect(rect.get("ry")).toBe(100);
  });

  it("refuses a negative border width, and the boundary clamps one that bypasses it", async () => {
    const rect = panel();
    const { editor, history, field } = setup(rect);
    const width = field<HTMLInputElement>("[data-yunari-panel-border-well]");
    const before = rect.get("strokeWidth") as number;

    await edit(width, "-4");

    // The field refuses the draft with its reason rather than clamping it: the
    // track cannot reach below zero either, and §5's validation belongs to the
    // one number control, which says why rather than coercing.
    expect(rect.get("strokeWidth")).toBe(before);
    expect(history.saveState).not.toHaveBeenCalled();
    expect(
      document.getElementById(`${width.id}-invalid`)?.textContent?.trim(),
    ).toBe("at least 0");

    // The rule that a bounded number **lands on its bound** is the writer's, and
    // it still holds for a commit that reached it without the control.
    rect.set({ strokeWidth: 4 });
    expect(
      writePanelField(
        rect,
        { editor: editor as never, globals: globals as never },
        "panel-border",
        -4,
      ),
    ).toBe(true);
    expect(rect.get("strokeWidth")).toBe(0);
  });

  it("refuses a fractional paint number rather than rounding it", async () => {
    const rect = panel();
    rect.set({ strokeWidth: 4, rx: 6, ry: 6 });
    rect.set("shadow", new Shadow({ color: "#ecf5ff", blur: 8 }));
    const { host, history } = setup(rect);

    // Every paint number the panel offers refused a fraction before its field
    // was converted — the old `numberField` demanded `Number.isInteger` — and
    // the converted control restates that as `integer`. The visible line is the
    // refusal; the write funnel re-checks the same rule, so a bypassed control
    // stores nothing either. Rounding would be a different act from displaying a
    // value a gesture left fractional.
    for (const selector of [
      "[data-yunari-panel-border-well]",
      "[data-yunari-panel-radius-well]",
      "[data-yunari-panel-shadow-blur-well]",
    ]) {
      const box = host.querySelector<HTMLInputElement>(selector)!;
      await edit(box, "4.5");
      expect(
        host.querySelector(`[id="${box.id}-invalid"]`)?.textContent?.trim(),
        selector,
      ).toBeTruthy();
      // The draft is kept with its reason rather than restored to the old value:
      // plan-1's number holds a rejected draft, where the pre-plan field put the
      // old value back. Either way nothing fractional is stored.
      expect(box.value, selector).toBe("4.5");
    }

    expect(rect.get("strokeWidth")).toBe(4);
    expect(rect.get("rx")).toBe(6);
    expect((rect.get("shadow") as Shadow).blur).toBe(8);
    expect(history.saveState).not.toHaveBeenCalled();
  });

  it("refuses an emptied numeric field instead of reading it as zero", async () => {
    const rect = panel();
    rect.set({ rx: 18, ry: 18 });
    const { history, field } = setup(rect);
    const radius = field<HTMLInputElement>("[data-yunari-panel-radius-well]");

    await edit(radius, "");

    // `Number("")` is 0, so an empty box must not become a zero radius.
    expect(rect.get("rx")).toBe(18);
    expect(history.saveState).not.toHaveBeenCalled();
  });

  it("offers only solid tokens for a shadow colour", async () => {
    const { host } = setup(panel());
    const names = await optionsOf(host, "data-yunari-panel-shadow");

    expect(names).toContain("Text");
    // Fabric's Shadow colour is a string; the envelope refuses a gradient
    // reference rather than drawing one, so it must never be offered here.
    expect(names).not.toContain("Scene");
  });

  it("gives a chosen shadow token a real, offset, tunable shadow", async () => {
    const rect = panel();
    const { host, history } = setup(rect);

    await choose(host, "data-yunari-panel-shadow", "Text");
    history.saveState.mockClear();

    const shadow = rect.get("shadow");
    expect(shadow).toBeInstanceOf(Shadow);
    // A colour alone paints nothing, so the committed edit must leave a shadow
    // the author can see and then tune — and one that falls below the panel
    // rather than glowing evenly around it.
    expect((shadow as Shadow).blur).toBeGreaterThan(0);
    expect((shadow as Shadow).color).toBe("#ecf5ff");
    expect((shadow as Shadow).offsetY).toBeGreaterThan(0);

    await edit(
      host.querySelector<HTMLInputElement>("[data-yunari-panel-shadow-blur]")!,
      "24",
    );

    expect((rect.get("shadow") as Shadow).blur).toBe(24);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("moves the shadow down without touching its blur", async () => {
    const rect = panel();
    rect.set({
      [YUNARI_PAINT_PROPERTY]: { shadowColor: "palette.text" },
      shadow: new Shadow({ color: "#ecf5ff", blur: 18, offsetY: 6 }),
    });
    const { field } = setup(rect);

    await edit(
      field<HTMLInputElement>("[data-yunari-panel-shadow-offset]"),
      "12",
    );

    const shadow = rect.get("shadow") as Shadow;
    expect(shadow.offsetY).toBe(12);
    expect(shadow.blur).toBe(18);
  });

  it("accepts a negative offset, which an imported shadow may already carry", async () => {
    const rect = panel();
    rect.set({
      [YUNARI_PAINT_PROPERTY]: { shadowColor: "palette.text" },
      shadow: new Shadow({ color: "#ecf5ff", blur: 8, offsetY: -6 }),
    });
    const { history, field } = setup(rect);
    const offset = field<HTMLInputElement>("[data-yunari-panel-shadow-offset]");
    expect(offset.value).toBe("-6");

    await edit(offset, "-3");

    // A floor of zero would show the imported value and then refuse the same
    // value back, which is a control that contradicts itself.
    expect((rect.get("shadow") as Shadow).offsetY).toBe(-3);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("shows no shadow controls until a shadow exists", () => {
    const { host } = setup(panel());

    // A blur box over a panel with no shadow accepts an edit and applies none.
    expect(host.querySelector("[data-yunari-panel-shadow-blur]")).toBeNull();
    expect(host.querySelector("[data-yunari-panel-shadow-offset]")).toBeNull();
  });

  it("removes the shadow and its reference when the token is cleared", async () => {
    const rect = panel();
    rect.set({
      [YUNARI_PAINT_PROPERTY]: {
        fill: "palette.background",
        shadowColor: "palette.text",
      },
      shadow: new Shadow({ color: "#ecf5ff", blur: 8 }),
    });
    const { host } = setup(rect);

    await choose(
      host,
      "data-yunari-panel-shadow",
      uiCopy.inspectorFields.notSet,
    );

    expect(rect.get("shadow")).toBeNull();
    expect(rect.get(YUNARI_PAINT_PROPERTY)).toEqual({
      fill: "palette.background",
    });
    expect(host.querySelector("[data-yunari-panel-shadow-blur]")).toBeNull();
    expect(host.querySelector("[data-yunari-panel-shadow-offset]")).toBeNull();
  });

  it("offers a selection that is not a panel no panel controls at all", () => {
    const text = new Textbox("Hi", { left: 0, top: 0, width: 40 });
    const { host } = setup(text);

    // A text object has no corner radius and no border; a control that cannot
    // apply is worse than an absent one.
    for (const selector of [
      "[data-yunari-panel-fill]",
      "[data-yunari-panel-stroke]",
      "[data-yunari-panel-border]",
      "[data-yunari-panel-radius]",
      "[data-yunari-panel-shadow]",
    ]) {
      expect(host.querySelector(selector), selector).toBeNull();
    }
    // And the fields it does own are untouched by that gate.
    expect(host.querySelector("[data-yunari-opacity]")).not.toBeNull();
  });

  it("disconnects the panel's controls when the selection moves under them", () => {
    const first = panel();
    const { host, history, editor, inspector } = setup(first);
    const fill = host.querySelector<HTMLElement>("[data-yunari-panel-fill]")!;
    const second = panel();
    second.set("id", "second");
    (editor.canvas as { getActiveObject: () => unknown }).getActiveObject =
      () => second;

    // The republish a real selection change fires. React keys each row by the
    // revision it was projected from, so the control bound to `first` is
    // unmounted — an edit from it cannot reach the object the panel now
    // describes, and it cannot write to the one it has left.
    inspector.render();

    expect(first.get(YUNARI_PAINT_PROPERTY)).toBeUndefined();
    expect(history.saveState).not.toHaveBeenCalled();
    expect(fill.isConnected).toBe(false);
    // And the column now describes the object that is actually selected.
    expect(
      host.querySelector<HTMLElement>("[data-yunari-panel-fill]"),
    ).not.toBe(fill);
  });

  it("records no history for a selection that only redraws the panel", () => {
    const rect = panel();
    const host = document.createElement("div");
    const saveState = vi.fn();
    const inspector = createSelectionInspector(host, {
      editor: {
        canvas: {
          getActiveObject: () => rect,
          getObjects: () => [rect],
          requestRenderAll: vi.fn(),
          on: vi.fn(),
          off: vi.fn(),
        },
        historyManager: { saveState },
        errorManager: { warn: vi.fn(), error: vi.fn() },
        cropManager: idleCrop(),
      } as never,
      globals,
      refreshGlass: vi.fn(),
    });

    inspector.render();
    inspector.render();

    expect(saveState).not.toHaveBeenCalled();
  });
});

describe("shape material and a shape's own fields", () => {
  it.each(SHAPES)("offers the material fields for a %s", (kind, build) => {
    const { host } = setup(build());

    // Every one of these classes owns a fill, a stroke, a border width and a
    // shadow. Offering them for one kind only would leave a shape that can be
    // placed and not coloured.
    for (const selector of [
      "[data-yunari-panel-border]",
      "[data-yunari-panel-shadow]",
    ]) {
      expect(host.querySelector(selector), selector).not.toBeNull();
    }

    // One control on the paint, not two — and which property it writes is the
    // scene's own decision, from `paintPropertyFor`. An unfilled open shape
    // (a polyline, a line, an arc) is ink rather than fill, so it offers the
    // one labelled control; everything else offers Fill *and* Stroke, since a
    // closed shape legitimately paints either. `ink.dom.test.ts` is what
    // proves the unfilled case does not flood.
    const strokeOnly = kind === "arc";
    expect(host.querySelector("[data-yunari-panel-fill]"), kind).not.toBeNull();
    expect(
      host.querySelector("[data-yunari-panel-stroke]") !== null,
      kind,
    ).toBe(!strokeOnly);
  });

  it.each(SHAPES)(
    "offers a corner radius for a %s only when it is a rectangle",
    (kind, build) => {
      const { host } = setup(build());
      const radius = host.querySelector("[data-yunari-panel-radius]");

      // A radius box over a shape Fabric gives no `rx` to would show `NaN` and
      // write a property the object does not read.
      expect(radius !== null, kind).toBe(kind === "rect");
    },
  );

  it.each(SHAPES)(
    "gives every material field on a %s an accessible name",
    (kind, build) => {
      const shape = build();
      shape.set(
        "shadow",
        new Shadow({ color: "#ecf5ff", blur: 8, offsetY: 4 }),
      );
      const { host } = setup(shape);

      // The converted surface carries each hook on the control a person
      // operates and emits none of the pre-conversion classes at all, so the
      // old selector matched nothing and this case stayed green on its `> 0`
      // guard — which cannot tell "every field" from "one field". Selecting by
      // the surface's own hooks is the re-point; naming every expected hook is
      // the guard the count never was.
      //
      // Every shape owns these, except the glass switch: a shape the treatment
      // cannot reach — an open path, a line, a polyline, an arc — is offered no
      // glass section at all (`vg-465`), and the same gate that decides that is
      // asked here rather than hand-listed, so this census cannot drift into a
      // second copy of it. `stroke` is absent on an arc — its one paint field
      // already writes the stroke and is labelled `Ink` — and the corner radius
      // is a `Rect`'s alone.
      const expected = [
        "[data-yunari-panel-fill]",
        "[data-yunari-panel-border]",
        "[data-yunari-panel-shadow]",
        "[data-yunari-panel-shadow-blur]",
        "[data-yunari-panel-shadow-offset]",
        ...(supportsGlassControl(shape) ? ["[data-yunari-glass-enabled]"] : []),
        ...(kind === "arc" ? [] : ["[data-yunari-panel-stroke]"]),
        ...(kind === "rect" ? ["[data-yunari-panel-radius]"] : []),
      ];
      for (const hook of expected) {
        expect(host.querySelector(hook), `${kind}: ${hook}`).not.toBeNull();
      }
      // And nothing this shape must not have: a radius on a `Wedge` would read
      // back `NaN`.
      if (kind !== "rect") {
        expect(
          host.querySelector("[data-yunari-panel-radius]"),
          kind,
        ).toBeNull();
      }
      // The other side of the glass gate, so the list above cannot pass by
      // listing a hook nothing draws.
      if (!supportsGlassControl(shape)) {
        expect(
          host.querySelector("[data-yunari-glass-enabled]"),
          `${kind} is offered no glass control`,
        ).toBeNull();
      }

      for (const hook of expected) {
        const control = host.querySelector<HTMLElement>(hook)!;
        const name =
          host
            .querySelector<HTMLLabelElement>(`label[for="${control.id}"]`)
            ?.textContent?.trim() ??
          control.getAttribute("aria-labelledby") ??
          "";
        expect(name, `${kind}: ${control.outerHTML}`).toBeTruthy();
      }
    },
  );

  it("files a shape's material under Paint and its own geometry under Position", () => {
    const polygon = new Polygon([...CORNERS], PLACED);
    const { host, field } = setup(polygon);

    // Material is what ink; a side count is where and how big. A shape's own
    // fields are not a lesser selection, and they are not one section either.
    expect(
      field<HTMLElement>(
        '[data-yunari-section="paint"] [data-yunari-panel-fill]',
      ),
    ).not.toBeNull();
    expect(
      field<HTMLElement>(
        '[data-yunari-section="position"] [data-yunari-shape-sides]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector(
        '[data-yunari-section="paint"] [data-yunari-shape-sides]',
      ),
    ).toBeNull();
  });

  it("writes a chosen fill onto a shape that is not a rectangle", async () => {
    const triangle = new Triangle({ ...PLACED, width: 360, height: 200 });
    const { host, history } = setup(triangle);

    await choose(host, "data-yunari-panel-fill", "Text");

    expect(triangle.fill).toBe("#ecf5ff");
    expect(triangle.get(YUNARI_PAINT_PROPERTY)).toEqual({
      fill: "palette.text",
    });
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("offers a polygon's side count as a slider, bounded at both ends", () => {
    const polygon = new Polygon([...CORNERS], PLACED);
    const { field } = setup(polygon);
    const sides = field<HTMLInputElement>("[data-yunari-shape-sides]");

    // A bounded number is DESIGN.md's slider (§5), and the pre-plan field drew
    // one because both bounds were present. The bound is the control's now, so
    // a two-sided polygon is unreachable rather than landed on.
    expect(sides.type).toBe("range");
    expect(sides.getAttribute("min")).toBe("3");
    expect(sides.getAttribute("max")).toBe("32");
    expect(sides.value).toBe("3");
  });

  it("redraws a polygon with the side count the author steps to", async () => {
    const polygon = new Polygon([...CORNERS], {
      ...PLACED,
      left: 20,
      top: 30,
    });
    const { history, field } = setup(polygon);
    const sides = field<HTMLInputElement>("[data-yunari-shape-sides]");

    // Three one-step key presses are a three-to-six gesture; jsdom has no
    // layout, so a pointer drag ends on no value at all (see `slide`).
    await slide(sides, "ArrowRight");
    await slide(sides, "ArrowRight");
    await slide(sides, "ArrowRight");

    expect(polygon.points).toHaveLength(6);
    // The box the author placed is theirs. Its *size* is re-fitted from the
    // corners on each step, so a three-step gesture is three edits, not one
    // jump — the old number field could only make the single jump, and the
    // placement is what the slider must not move.
    expect(polygon.left).toBe(20);
    expect(polygon.top).toBe(30);
    expect(history.saveState).toHaveBeenCalled();
  });

  it("refuses a non-finite endpoint at the funnel, the one branch that wrote it unchecked", () => {
    const line = new Line([0, 0, 100, 50], PLACED);

    // Called directly, not through the field: `ControlNumber`'s own parse
    // refuses a non-numeric draft before it ever commits, so no field can red
    // this line — which is exactly why the guard is the funnel's, and why
    // driving the control (the case below) measures reachability rather than
    // the guard.
    expect(writeShapeGeometryField(line, "shape-line-x1", "abc")).toBe(false);
    expect(writeShapeGeometryField(line, "shape-line-y2", "Infinity")).toBe(
      false,
    );
    expect(line.x1).toBe(0);
    expect(line.y2).toBe(50);
    expect(Number.isFinite(line.x1) && Number.isFinite(line.y2)).toBe(true);
  });

  it("refuses a non-numeric endpoint through the control, and says so in the field", async () => {
    const line = new Line([0, 0, 100, 50], PLACED);
    const { history, field } = setup(line);
    const endpoint = field<HTMLInputElement>('[data-yunari-shape-line="x1"]');

    await edit(endpoint, "abc");

    // The write never arrives: the control holds the refusal and the object is
    // left exactly as it was.
    expect(line.x1).toBe(0);
    expect(history.saveState).not.toHaveBeenCalled();
    expect(endpoint.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a polyline's own points and writes back the ones typed", async () => {
    const polyline = new Polyline([...CORNERS], PLACED);
    const { history, field } = setup(polyline);
    const points = field<HTMLTextAreaElement>("[data-yunari-shape-points]");

    expect(points.value).toBe("0, 0\n100, 0\n50, 100");

    await edit(points, "1, 2\n3, 4");

    expect(polyline.points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it.each(["a, b", "1, 2, 3", "1, 2\nnot a point", "1, 2\n"])(
    "refuses %o as a polyline's points rather than reading it as zero",
    async (typed) => {
      const polyline = new Polyline([...CORNERS], PLACED);
      const before = polyline.points;
      const { history, editor, field } = setup(polyline);

      await edit(
        field<HTMLTextAreaElement>("[data-yunari-shape-points]"),
        typed,
      );

      expect(polyline.points).toEqual(before);
      expect(history.saveState).not.toHaveBeenCalled();
      expect(editor.errorManager.warn).toHaveBeenCalled();
    },
  );

  it("moves a line from its own two endpoints", async () => {
    const line = new Line([0, 0, 100, 50], PLACED);
    const { history, field } = setup(line);

    await edit(field<HTMLInputElement>('[data-yunari-shape-line="x2"]'), "200");

    expect(line.x2).toBe(200);
    expect(line.x1).toBe(0);
    expect(line.width).toBe(200);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("shows a path's own data as editable path data", async () => {
    const path = new Path("M 0 0 L 100 0 L 0 50 Z", PLACED);
    const { history, field } = setup(path);
    const data = field<HTMLTextAreaElement>("[data-yunari-shape-path]");

    expect(data.value).toBe("M 0 0 L 100 0 L 0 50 Z");

    await edit(data, "M 0 0 L 10 10");

    // Fabric's own parser is the one that reads it, and its normalised
    // commands are what the scene persists.
    expect(path.path).toEqual([
      ["M", 0, 0],
      ["L", 10, 10],
    ]);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it.each(["not a path", "   ", "M 0 0"])(
    "refuses %o as a path rather than emptying the shape",
    async (typed) => {
      const path = new Path("M 0 0 L 100 0 L 0 50 Z", PLACED);
      const before = path.path;
      const { history, editor, field } = setup(path);
      const data = field<HTMLTextAreaElement>("[data-yunari-shape-path]");

      await edit(data, typed);

      // A path Fabric cannot parse comes back empty, and a lone moveto has no
      // extent at all: either would replace a real shape with one nothing can
      // select or see.
      expect(path.path).toEqual(before);
      expect(data.value).toBe("M 0 0 L 100 0 L 0 50 Z");
      expect(history.saveState).not.toHaveBeenCalled();
      expect(editor.errorManager.warn).toHaveBeenCalled();
    },
  );
});

describe("a shape whose geometry the author retypes", () => {
  /**
   * Measured on the surface while drawing the device icons: a path sized to
   * 28 × 28 and then given 14 × 14 of new data drew **1 × 3 units**. Its
   * commands are absolute coordinates in its own space, so the scale the
   * earlier size wrote belonged to a drawing that no longer exists — and
   * insert-then-size-then-draw is the order every icon in a dashboard is built
   * in.
   */
  it("drops the scale the previous geometry left behind", async () => {
    const path = new Path("M 0 0 L 360 0 L 360 150 L 0 150 Z", {
      id: "icon",
      left: 100,
      top: 100,
    });
    path.set({ scaleX: 28 / 360, scaleY: 28 / 150 });
    const { host } = setup(path);

    const data = host.querySelector<HTMLTextAreaElement>(
      "[data-yunari-shape-path]",
    )!;
    await edit(data, "M 7 7 L 21 7 L 21 21 L 7 21 Z");

    expect(path.scaleX).toBe(1);
    expect(path.scaleY).toBe(1);
    // 14 units of square data, drawn as 14 units.
    expect(path.width).toBeCloseTo(14, 1);
    expect(path.width * path.scaleX).toBeCloseTo(14, 1);
  });

  it("does the same for a polyline's points", async () => {
    const line = new Polyline(
      [
        { x: 0, y: 200 },
        { x: 360, y: 0 },
      ],
      { id: "spark", left: 0, top: 0 },
    );
    line.set({ scaleX: 0.5, scaleY: 0.5 });
    const { host } = setup(line);

    const points = host.querySelector<HTMLTextAreaElement>(
      "[data-yunari-shape-points]",
    )!;
    await edit(points, "10, 20\n30, 40");

    expect(line.scaleX).toBe(1);
    expect(line.scaleY).toBe(1);
  });
});

/**
 * The failure mode the brief names: a kind the panel's gate does not admit is
 * inserted and cannot be shaped. Nothing errors — the object arrives, is
 * selectable, and simply has no fields — so these cases assert the fields are
 * *present*, and then that a typed angle reaches the object.
 */
describe("the angles of a swept shape", () => {
  const SWEPT = ["arc", "wedge"] as const;

  /**
   * Both angle fields share one `data-` name and are told apart by its value,
   * the way a line's four endpoint boxes already are: they are one kind of
   * number about one thing, so they are one selector with a key rather than two
   * unrelated names that could drift apart.
   */
  const ANGLE = {
    start: '[data-yunari-shape-angle="startAngle"]',
    end: '[data-yunari-shape-angle="endAngle"]',
  } as const;

  /** A new shape of a swept kind, narrowed to the class that owns the angles. */
  function swept(kind: (typeof SWEPT)[number]): Circle {
    return createNewShape(kind, globals, kind, {
      left: 0,
      top: 0,
    }) as Circle;
  }

  it.each(SWEPT)("offers a start and an end angle for a %s", (kind) => {
    const { host } = setup(swept(kind));

    expect(host.querySelector(ANGLE.start), kind).not.toBeNull();
    expect(host.querySelector(ANGLE.end), kind).not.toBeNull();
  });

  it.each(SWEPT)("bounds each %s angle as a slider", (kind) => {
    const { field } = setup(swept(kind));
    const end = field<HTMLInputElement>(ANGLE.end);

    // Both bounds were present pre-plan, so the field drew a slider; DESIGN.md
    // calls a bounded number a slider (§5), so the converted field is one too.
    expect(end.type, kind).toBe("range");
    expect(end.getAttribute("min"), kind).toBe("0");
    expect(end.getAttribute("max"), kind).toBe("360");
  });

  it.each(SWEPT)("writes a stepped %s angle onto the object", async (kind) => {
    const shape = swept(kind);
    const { field, history } = setup(shape);
    const start = field<HTMLInputElement>(ANGLE.start);
    const before = Number(start.value);

    await slide(start, "ArrowRight");

    expect(shape.startAngle).toBe(before + 1);
    expect(history.saveState).toHaveBeenCalled();
  });

  it("keeps offering the angles when the author sweeps a full turn", () => {
    // The gate is the class, never the current numbers. A circle's own defaults
    // are 0° and 360°, so a gate that asked "is this the default sweep?" would
    // take the fields away the moment an author closed an arc back up — and an
    // author whose controls vanish mid-edit has to reload to get them back.
    const shape = swept("arc");
    shape.set({ startAngle: 0, endAngle: 360 });
    const { host } = setup(shape);

    expect(host.querySelector(ANGLE.start)).not.toBeNull();
    expect(host.querySelector(ANGLE.end)).not.toBeNull();
  });

  it("offers no angle fields to a shape that carries no sweep", () => {
    // The converse guard. A rectangle owns no angles, and a control that wrote
    // one would write a property nothing on that object reads.
    const { host } = setup(
      new Rect({ ...PLACED, width: 360, height: 200, rx: 10, ry: 10 }),
    );

    expect(host.querySelector(ANGLE.start)).toBeNull();
    expect(host.querySelector(ANGLE.end)).toBeNull();
  });

  it("lands an angle on the bound the author sweeps to, never past it", async () => {
    // The bound teaches itself: the slider stops at 0–360, so an angle of 450 is
    // unreachable rather than wrapped. A wrap — 450 drawn as 90 — is a shape the
    // author did not ask for and cannot see the difference in.
    const shape = swept("wedge");
    shape.set("endAngle", 90);
    const { field } = setup(shape);

    await slide(field<HTMLInputElement>(ANGLE.end), "End");

    expect(shape.endAngle).toBe(360);
  });
});
