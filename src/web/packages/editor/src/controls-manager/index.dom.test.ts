// @vitest-environment jsdom

import { Canvas, IText, Textbox } from "fabric/es";
import { describe, expect, it } from "vitest";
import { applyEditorControls } from "./index.js";

/** The artboard every drag in this file is made against. */
const ARTBOARD_HEIGHT = 1080;

/**
 * A textbox's vertical edge, dragged.
 *
 * vg-089: an author applied a type preset taller than the box they wrote, and
 * the text was clipped with no way to move the box by hand — the two vertical
 * handles were hidden. What the handle writes is the part that decides whether
 * it works: Fabric's `height` is re-derived from the wrapped text on every
 * `initDimensions` (`fabric/dist/index.mjs:18452`), so a handle that stopped
 * there would be undone by the next text pass. The authored box is what
 * persists, and the object reads it back.
 */

/** A `Textbox` in the vg-089 state: a 90px run in an authored 27-tall box. */
function textbox(height: number): Textbox {
  const object = new Textbox("CPU", { width: 140, height, fontSize: 90 });
  object.set("yunariText", {
    runs: [{ kind: "literal", text: "CPU" }],
    box: { width: 140, height },
  });
  return object;
}

/** Presses `key`, drags the edge to `to`, and lets go — the whole gesture. */
function drag(object: Textbox, key: string, to: number): void {
  // The first call installs the controls; later calls are no-ops, so the
  // artboard getter is fixed for the module by this one.
  applyEditorControls(() => ARTBOARD_HEIGHT);
  const control = Textbox.ownDefaults.controls?.[key];
  if (control === undefined) throw new Error(`${key} is not a control`);
  const transform = { target: object } as never;
  control.mouseDownHandler?.({} as never, transform, 0, 0);
  object.set("height", to);
  control.mouseUpHandler?.({} as never, transform, 0, 0);
}

/** The same gesture without the move, which is not a resize. */
function press(object: Textbox, key: string): void {
  applyEditorControls(() => ARTBOARD_HEIGHT);
  const control = Textbox.ownDefaults.controls?.[key];
  const transform = { target: object } as never;
  control?.mouseDownHandler?.({} as never, transform, 0, 0);
  control?.mouseUpHandler?.({} as never, transform, 0, 0);
}

function boxOf(object: Textbox): unknown {
  return (object.get("yunariText") as { box?: unknown }).box;
}

describe("a textbox's vertical edge writes the authored box", () => {
  it("records the dragged height in the box, not in Fabric's own height", () => {
    const object = textbox(27);

    drag(object, "mb", 130);

    expect(boxOf(object)).toMatchObject({ width: 140, height: 130 });
  });

  it("leaves Fabric's derived height to the pass that owns it", () => {
    const object = textbox(27);

    drag(object, "mb", 130);

    // The height itself is not what persists. Asserting it would pin Fabric's
    // derivation, which the next text pass overwrites on purpose.
    expect(object.height).toBe(130);
  });

  it("authors a whole box from an object that had none", () => {
    // A text object the editor inserted carries runs but no box: its height is
    // whatever Fabric measured, which is the case the handle is for. Writing the
    // height alone would leave `{ height }` with no width, and `authoredBox`
    // would multiply an `undefined` width by the scale on the next pass.
    const object = new Textbox("CPU", { width: 140, fontSize: 90 });
    object.set("yunariText", { runs: [{ kind: "literal", text: "CPU" }] });

    drag(object, "mb", 130);

    // Its own measured width, not the 140 it was built at: without a box the
    // object has widened to its longest run, and the seeded box has to say what
    // is on the canvas rather than what was asked for.
    expect(boxOf(object)).toMatchObject({
      width: object.width,
      height: 130,
    });
    expect(object.width).toBeGreaterThan(140);
  });

  it("refuses a height that is not a usable number rather than coercing it", () => {
    const object = textbox(27);

    drag(object, "mb", Number.NaN);

    // The box the author already had is left alone: a non-number is not a
    // height, and zero would be a box nothing can paint in.
    expect(boxOf(object)).toMatchObject({ width: 140, height: 27 });
  });

  it("records the dragged height unscaled, on a scaled object", () => {
    // `yunariText.box` is the number the object measures against and
    // `boxFrom` puts the scale back on for the clip. Multiplying here would
    // grow the box by the scale on every drag.
    const object = textbox(27);
    object.set("scaleY", 1.5);

    drag(object, "mb", 87);

    expect(boxOf(object)).toMatchObject({ width: 140, height: 87 });
  });

  it("records nothing for a press with no move", () => {
    // The handle sits on the object's own bounds, which for a clipped textbox
    // is the taller of the text and the box — 145 here, against a 27 box.
    // Recording that on a bare click would turn a click into a silent
    // enlargement of a box the author never touched.
    const object = textbox(27);
    object.set("height", 145);

    press(object, "mb");

    expect(boxOf(object)).toMatchObject({ width: 140, height: 27 });
  });
});

describe("the release repaint carries the artboard height", () => {
  it("paints a run's role default when it authored no size", () => {
    const object = new Textbox("CPU", {
      id: "label",
      width: 140,
      fontSize: 90,
    });
    object.set("yunariText", {
      runs: [{ kind: "literal", text: "CPU", typeToken: "typeTokens.heading" }],
      box: { width: 140, height: 27 },
    });
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(object);

    drag(object, "mb", 130);

    // Heading at 1080 is 72. Without the artboard height on this pass the
    // object keeps the 90 it was built at until the next runtime tick.
    expect(object.fontSize).toBe(72);
  });
});

describe("a text's own controls", () => {
  it("carries corners and rotation only, with no box-writing edges", () => {
    applyEditorControls();

    // The text measures its own ink, so a width or height drag has no authored
    // box to write. Asserted on an instance, because that is what the canvas
    // reads: the constructor spreads `IText.ownDefaults` into its options.
    expect(Object.keys(new IText("CPU").controls).sort()).toEqual([
      "bl",
      "br",
      "mtr",
      "tl",
      "tr",
    ]);
  });
});
