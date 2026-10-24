import {
  ActiveSelection,
  InteractiveFabricObject,
  IText,
  Line,
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

  it("gives a line two ends and a rotation, and no bounding box", () => {
    applyEditorControls();
    const controls = Line.ownDefaults.controls;

    // The bounding box is the wrong shape for a line: its corners sit on the
    // ends only by luck, and its other six handles do nothing for a shape with
    // two points. Measured on the editor's own line before this: ml, mr, mb,
    // mt, tl, tr, bl, br, mtr.
    expect(Object.keys(controls ?? {}).sort()).toEqual([
      "endpointA",
      "endpointB",
      "mtr",
    ]);
  });

  it("puts an endpoint handle on each end, whichever way the line was drawn", () => {
    applyEditorControls();
    const controls = Line.ownDefaults.controls ?? {};

    const at = (line: Line, key: string): { x: number; y: number } => {
      const control = controls[key];
      if (control?.positionHandler === undefined)
        throw new Error(`${key} has no position handler`);
      const point = control.positionHandler(
        { x: 0, y: 0 } as never,
        [] as never,
        line,
        control,
      );
      return { x: Math.round(point.x), y: Math.round(point.y) };
    };

    // Asserted as the gap between the two handles, not as absolute numbers:
    // the handles are returned in the object's own frame, and where that frame
    // sits is Fabric's business. The gap is the line.
    const gap = (line: Line) => {
      const a = at(line, "endpointA");
      const b = at(line, "endpointB");
      return { x: b.x - a.x, y: b.y - a.y };
    };

    expect(gap(new Line([0, 0, 360, 200]))).toEqual({ x: 360, y: 200 });
    // Drawn right-to-left and up: the same two numbers mean the OTHER corners,
    // which is why a handle cannot be pinned to a corner of the box.
    expect(gap(new Line([360, 200, 0, 0]))).toEqual({ x: -360, y: -200 });
    // A diagonal the other way, to catch a test that only ever sees one shape.
    expect(gap(new Line([0, 200, 360, 0]))).toEqual({ x: 360, y: -200 });
  });

  it("moves only the end being dragged, and constrains the angle under Shift", () => {
    applyEditorControls();
    const controls = Line.ownDefaults.controls ?? {};
    const line = new Line([0, 0, 360, 200]);
    const drag = (key: string, x: number, y: number, shift = false) => {
      const control = controls[key];
      if (control === undefined || control.actionHandler === undefined)
        throw new Error(`${key} cannot be dragged`);
      return control.actionHandler(
        { shiftKey: shift } as never,
        { target: line } as never,
        x,
        y,
      );
    };

    const far = { x2: line.x2, y2: line.y2 };
    drag("endpointB", 400, 0);
    // The other end did not move — that is the whole point of an end handle.
    expect({ x1: line.x1, y1: line.y1 }).toEqual({ x1: 0, y1: 0 });
    // The dragged end is a point: both of its scalars follow the pointer, so a
    // handler that wrote only `x2` would leave `y2` at its old value (vg-377).
    expect(line.x2).not.toBe(far.x2);
    expect(line.y2).not.toBe(far.y2);

    // Shift holds the line at a multiple of 15 degrees, so a free drag cannot
    // leave it a few degrees off level.
    drag("endpointB", 1000, 300, true);
    const degrees =
      (Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI;
    expect(degrees / 15).toBeCloseTo(Math.round(degrees / 15), 5);
    expect(Math.round(degrees / 15)).toBe(1);
  });

  it("is idempotent", () => {
    applyEditorControls();
    const first = InteractiveFabricObject.ownDefaults.controls;
    applyEditorControls();

    expect(InteractiveFabricObject.ownDefaults.controls).toBe(first);
  });
});
