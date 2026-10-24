// @vitest-environment jsdom

/**
 * `paintPropertyFor`, the rule that sends an icon's paint to the stroke.
 *
 * The pixels are proved in the editor's own selection-inspector suite; this is
 * the unit side — which property each object writes, and that the reference
 * survives a save and comes back as paint, since the panel now files it under
 * a different key than it used to.
 */

import type { Globals } from "@yunari/renderer-core";
import { Circle, Path, Polyline, Rect, StaticCanvas } from "fabric/es";
import { describe, expect, it } from "vitest";
import {
  applyObjectPalettePaints,
  paintPropertyFor,
  YUNARI_PAINT_PROPERTY,
} from "./object-paint.js";
import { reviveScene, serialiseScene } from "./persist.js";
import { Arc, Wedge } from "./sector-object.js";

const globals = {
  palette: {
    cpu: { name: "CPU", value: { kind: "solid", color: "#4da3ff" } },
    text: { name: "Text", value: { kind: "solid", color: "#ecf5ff" } },
    panel: { name: "Panel", value: { kind: "solid", color: "#1a1f2b" } },
  },
} as unknown as Globals;

const canvasOf = (...objects: readonly unknown[]) => {
  const canvas = new StaticCanvas(undefined, { width: 200, height: 200 });
  canvas.add(...(objects as never[]));
  return canvas;
};

describe("paintPropertyFor", () => {
  it("sends an unfilled path's paint to its stroke", () => {
    // The Starter authors its icons exactly so: `fill: null`, with stroke and
    // strokeWidth carrying the ink. This is what `newShapeStroke` produces for
    // a line and a polyline, and what the storage icon is.
    const icon = new Path("M 0 0 L 10 0 L 0 5 Z", {
      fill: null,
      stroke: "#4da3ff",
      strokeWidth: 3.3,
    });

    expect(paintPropertyFor(icon)).toBe("stroke");
  });

  it("leaves a filled path filling the region it encloses", () => {
    // The product's own new-path default arrives filled, and so does any
    // filled author's glyph. Their counters are declared as holes, which is
    // the one case a fill rule could have served.
    expect(
      paintPropertyFor(new Path("M 0 0 L 10 0 L 0 5 Z", { fill: "#fff" })),
    ).toBe("fill");
    // A fill cleared through the inspector reads back as no fill at all.
    expect(
      paintPropertyFor(new Path("M 0 0 L 10 0 L 0 5 Z", { fill: "" })),
    ).toBe("stroke");
  });

  it("never touches an object that is not a path", () => {
    // A rect, a circle and a text run all fill the region they enclose, and a
    // chevron is a shape before it is an icon.
    for (const object of [
      new Rect({ width: 10, height: 10 }),
      new Circle({ radius: 5 }),
      new Path("M 0 0 L 10 0 L 0 5 Z"),
    ]) {
      expect(paintPropertyFor(object), object.constructor.name).toBe("fill");
    }
  });
});

describe("a stroke reference round-trips like a fill one", () => {
  it("is persisted and re-resolved to paint on revival", async () => {
    const icon = new Path("M 0 0 L 10 0 L 0 5 Z", {
      id: "storage-card-icon",
      fill: null,
      stroke: "#4da3ff",
      strokeWidth: 3.3,
    });
    icon.set(YUNARI_PAINT_PROPERTY, { stroke: "palette.text" });

    const scene = serialiseScene(canvasOf(icon));
    const revived = new StaticCanvas(undefined, { width: 200, height: 200 });
    await reviveScene(revived, scene);
    applyObjectPalettePaints(revived, globals);

    // The map is persisted whole, so which key the panel filed it under does
    // not change the guarantee; this is the same path a fill reference takes.
    expect(scene.objects[0]![YUNARI_PAINT_PROPERTY]).toEqual({
      stroke: "palette.text",
    });
    const back = revived.getObjects()[0]!;
    // The fill stays unset through the round trip, which is the point: the
    // reference moved to the stroke and nothing re-filled the counters.
    expect(back.fill).toBeNull();
    expect(back.stroke).toBe("#ecf5ff");
    // And the revived object is still read as a stroked path, not a filled one.
    expect(paintPropertyFor(back)).toBe("stroke");
  });
});

/**
 * A filled `Arc`, and the figure it would paint.
 *
 * The misreading this refuses is not hypothetical: an `Arc` is a `Circle`, and a
 * fill under `ctx.arc` closes the subpath with a straight chord. Measured on a
 * radius-80 sweep, a filled 0–90° arc paints **1933** pixels where a quarter-disc
 * is **5027**. An author who fills an arc is asking for a shape the product
 * cannot draw correctly, so the fill is refused rather than honoured — and the
 * refusal has to reach the object, because a warning nobody reads leaves exactly
 * the chord on the canvas.
 */
describe("an arc that carries a fill", () => {
  /** A hand-authored filled arc, as a saved theme would carry it. */
  const filledArc = (): Arc => {
    const arc = new Arc({
      left: 0,
      top: 0,
      radius: 100,
      startAngle: 0,
      endAngle: 90,
      fill: "#4da3ff",
      stroke: "",
    });
    arc.set(YUNARI_PAINT_PROPERTY, { fill: "palette.cpu" });
    return arc;
  };

  it("refuses the fill, so the shape keeps the stroke it can draw", () => {
    const arc = filledArc();
    const canvas = canvasOf(arc);

    applyObjectPalettePaints(canvas, globals);

    // The fill is gone rather than resolved, so Fabric draws the curve and not
    // the chord. Leaving the resolved colour in place is what this rules out.
    expect(arc.fill).toBe("");
    expect(paintPropertyFor(arc)).toBe("stroke");
  });

  it("refuses it through a save and reopen, which is how it arrives", () => {
    // The editor's own defaults cannot produce this — `newShapeStroke` gives an
    // arc no fill — so the only route is a theme written by hand or by an older
    // build. Going through `reviveScene` proves the refusal is not an artefact
    // of the live object being freshly constructed.
    const scene = serialiseScene(canvasOf(filledArc()));
    const revived = new StaticCanvas(undefined, { width: 200, height: 200 });
    return reviveScene(revived, scene).then(() => {
      applyObjectPalettePaints(revived, globals);
      const back = revived.getObjects()[0] as Arc;

      expect(back.fill).toBe("");
      expect(paintPropertyFor(back)).toBe("stroke");
    });
  });

  it("keeps the authored reference, because refusing a fill is not deleting it", () => {
    // The refusal is about what is **drawn**, and it is re-applied on every load,
    // so nothing depends on the reference being removed to survive. Removing it
    // costs the author their document instead: `yunariPaint` is a persisted
    // property, so dropping the key is written into the next save, and an author
    // who opens a theme carrying a hand-authored filled arc loses that fill for
    // good with nothing said. A retained reference paints nothing either way.
    const scene = serialiseScene(canvasOf(filledArc()));
    const revived = new StaticCanvas(undefined, { width: 200, height: 200 });

    return reviveScene(revived, scene).then(() => {
      applyObjectPalettePaints(revived, globals);
      const back = revived.getObjects()[0] as Arc;

      expect(back.fill, "paints no fill").toBe("");
      expect(back.get(YUNARI_PAINT_PROPERTY)).toEqual({
        fill: "palette.cpu",
      });
      // And the assertion that would have caught it: the reference survives a
      // further save, so a document opened and closed is not quietly rewritten.
      const saved = serialiseScene(revived);
      expect(saved.objects[0]![YUNARI_PAINT_PROPERTY]).toEqual({
        fill: "palette.cpu",
      });
    });
  });

  it("still fills a polyline that carries one, as it always has", () => {
    // The exception is arc-specific and has to stay that way: this rule has
    // always let a fill win for every other shape, and a polyline with a fill
    // fills.
    const polyline = new Polyline([
      { x: 0, y: 0 },
      { x: 40, y: 40 },
    ]);
    polyline.set({ fill: "#4da3ff", stroke: "" });
    polyline.set(YUNARI_PAINT_PROPERTY, { fill: "palette.cpu" });

    applyObjectPalettePaints(canvasOf(polyline), globals);

    expect(polyline.fill).toBe("#4da3ff");
  });

  it("still fills a wedge, whose sector is a region it really has", () => {
    const wedge = new Wedge({
      left: 0,
      top: 0,
      radius: 100,
      startAngle: 0,
      endAngle: 90,
      fill: "#4da3ff",
    });
    wedge.set(YUNARI_PAINT_PROPERTY, { fill: "palette.cpu" });

    applyObjectPalettePaints(canvasOf(wedge), globals);

    // The contrast case: refusing this one would be refusing the figure the
    // product added the kind to draw.
    expect(wedge.fill).toBe("#4da3ff");
  });
});

/**
 * A refused fill is said out loud.
 *
 * An author cannot set a fill on an arc through the inspector, so the only way
 * one arrives is a document written by hand or by an older build. It then opens,
 * paints no fill, and shows "Ink: not set" — with nothing said, the author
 * cannot tell that their document asked for something the editor declined to
 * draw. Telling them is the same situation as any other refusal the editor
 * reports out loud rather than leaving silent.
 */
describe("a refusal the author is told about", () => {
  it("reports the arc and names the shape, once", async () => {
    const reported: string[] = [];
    const scene = serialiseScene(canvasOf(filledArcForRefusal()));
    const revived = new StaticCanvas(undefined, { width: 200, height: 200 });
    await reviveScene(revived, scene);

    applyObjectPalettePaints(revived, globals, {
      onRefusedPaint: (message) => reported.push(message),
    });

    // Once, not once per property or per pass: a re-applied palette change must
    // not become a stream of the same sentence.
    expect(reported).toHaveLength(1);
    // Names the shape, because "an author picked that" is what they need told.
    expect(reported[0]).toMatch(/arc/i);
  });

  it("says nothing for a shape whose fill was honoured", async () => {
    const reported: string[] = [];
    const wedge = new Wedge({
      left: 0,
      top: 0,
      radius: 100,
      startAngle: 0,
      endAngle: 90,
      fill: "#4da3ff",
    });
    wedge.set(YUNARI_PAINT_PROPERTY, { fill: "palette.cpu" });

    applyObjectPalettePaints(canvasOf(wedge), globals, {
      onRefusedPaint: (message) => reported.push(message),
    });

    expect(reported).toEqual([]);
  });
});

/** The same hand-authored filled arc, named here so both describes can build it. */
function filledArcForRefusal(): Arc {
  const arc = new Arc({
    left: 0,
    top: 0,
    radius: 100,
    startAngle: 0,
    endAngle: 90,
    fill: "#4da3ff",
    stroke: "",
  });
  arc.set(YUNARI_PAINT_PROPERTY, { fill: "palette.cpu" });
  return arc;
}
