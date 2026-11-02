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
import { Circle, Path, Rect, StaticCanvas } from "fabric/es";
import { describe, expect, it } from "vitest";
import {
  applyObjectPalettePaints,
  paintPropertyFor,
  YUNARI_PAINT_PROPERTY,
} from "./object-paint.js";
import { reviveScene, serialiseScene } from "./persist.js";

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
    // strokeWidth carrying the ink. This is what `newShapeStroke` produces for a
    // custom line and an arc, and what the storage icon is.
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
