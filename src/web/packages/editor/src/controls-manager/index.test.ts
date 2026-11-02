import {
  ActiveSelection,
  InteractiveFabricObject,
  IText,
  Rect,
  Textbox,
} from "fabric/es";
import { describe, expect, it } from "vitest";
import { applyEditorControls } from "./index.js";

describe("applyEditorControls", () => {
  it("snaps rotation to whole degrees", () => {
    applyEditorControls();
    expect(InteractiveFabricObject.ownDefaults.snapAngle).toBe(1);
  });

  it("sizes corner handles square and edge handles as rects", () => {
    applyEditorControls();
    const controls = InteractiveFabricObject.ownDefaults.controls;

    expect(controls?.["tl"]).toMatchObject({ sizeX: 12, sizeY: 12 });
    expect(controls?.["br"]).toMatchObject({ sizeX: 12, sizeY: 12 });
    expect(controls?.["ml"]).toMatchObject({ sizeX: 8, sizeY: 20 });
    expect(controls?.["mt"]).toMatchObject({ sizeX: 20, sizeY: 8 });
  });

  it("gives the rotation handle a grab cursor and an offset", () => {
    applyEditorControls();
    const rotate = InteractiveFabricObject.ownDefaults.controls?.["mtr"];

    expect(rotate?.cursorStyle).toBe("grab");
    expect(rotate).toMatchObject({ sizeX: 32, sizeY: 32, offsetY: -32 });
  });

  it("gives the textbox the vertical-resize handles every other shape has", () => {
    applyEditorControls();
    const controls = Textbox.ownDefaults.controls;

    // vg-089: an author who picked a type preset taller than the authored box
    // had no way to move the box by hand. Corners and horizontal edges were
    // already there; these two were the whole of the gap.
    expect(controls?.["mt"]?.visible).not.toBe(false);
    expect(controls?.["mb"]?.visible).not.toBe(false);
    expect(controls?.["ml"]?.visible).not.toBe(false);
    // A visible handle that cannot be dragged is worse than an absent one.
    expect(controls?.["mt"]?.actionHandler).toBeTypeOf("function");
    expect(controls?.["mb"]?.actionHandler).toBeTypeOf("function");
  });

  it("gives a text corners and rotation, and no box-writing handles", () => {
    applyEditorControls();
    const controls = IText.ownDefaults.controls;

    // A text has no authored box, so a width or height drag has nowhere to
    // write. Measured before this: it carried ml, mr, mt and mb as well.
    expect(Object.keys(controls ?? {}).sort()).toEqual([
      "bl",
      "br",
      "mtr",
      "tl",
      "tr",
    ]);
  });

  it("leaves the textbox and every other object their edge handles", () => {
    applyEditorControls();
    const all = ["bl", "br", "mb", "ml", "mr", "mt", "mtr", "tl", "tr"];

    expect(Object.keys(Textbox.ownDefaults.controls ?? {}).sort()).toEqual(all);
    expect(Object.keys(new Rect().controls).sort()).toEqual(all);
  });

  it("leaves Fabric's ActiveSelection internals unpatched", () => {
    const before = ActiveSelection.prototype.onDeselect;
    applyEditorControls();

    // The fork patched private layout internals for its shape-composite types.
    expect(ActiveSelection.prototype.onDeselect).toBe(before);
  });

  it("is idempotent", () => {
    applyEditorControls();
    const first = InteractiveFabricObject.ownDefaults.controls;
    applyEditorControls();

    expect(InteractiveFabricObject.ownDefaults.controls).toBe(first);
  });
});
