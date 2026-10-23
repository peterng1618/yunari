// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { iconObject, iconShapes, placeIcon } from "./icon-shape.js";

const INK = { color: "#ecf5ff", ref: "palette.text" } as const;

/** Lucide's own shape: no fill, a stroke, round caps, two subpaths. */
const LUCIDE_STROKE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 3l9 7"/><path d="M5 9v11h14V9"/></svg>';

/** Font Awesome's: one filled silhouette with no stroke at all. */
const FILLED =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path d="M288 32 0 224v256h192V288h192v192h192V224z"/></svg>';

const ARTBOARD = { width: 1920, height: 1080 };

describe("iconShapes", () => {
  it("paints a stroked glyph with the theme's ink and keeps its width", async () => {
    const shapes = await iconShapes(LUCIDE_STROKE, INK);

    expect(shapes).toHaveLength(2);
    for (const shape of shapes) {
      expect(shape.type).toBe("path");
      expect(shape.get("stroke")).toBe(INK.color);
      expect(shape.get("strokeWidth")).toBe(2);
      expect(shape.get("fill")).toBeNull();
      expect(shape.get("yunariPaint")).toEqual({ stroke: INK.ref });
    }
  });

  it("paints a filled glyph with the same ink, as a fill", async () => {
    const shapes = await iconShapes(FILLED, INK);

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.get("fill")).toBe(INK.color);
    expect(shapes[0]?.get("yunariPaint")).toEqual({ fill: INK.ref });
  });

  it("answers no shapes for an SVG that draws none", async () => {
    // An empty SVG would otherwise place an object nothing can select.
    expect(
      await iconShapes('<svg xmlns="http://www.w3.org/2000/svg"></svg>', INK),
    ).toEqual([]);
  });
});

describe("iconObject and placeIcon", () => {
  it("is one object, centred, as a share of the artboard's shorter edge", async () => {
    const object = iconObject(
      await iconShapes(LUCIDE_STROKE, INK),
      "house",
      "icon-1",
    );

    placeIcon(object, ARTBOARD, 0.12);

    // Two subpaths, one object: a group would need ungrouping to recolour.
    expect(object.type).toBe("path");
    expect(object.get("name")).toBe("house");
    expect(object.get("stroke")).toBe(INK.color);
    // The paint token rides the join: a stroke without it is a document the
    // validator refuses to save.
    expect(object.get("yunariPaint")).toEqual({ stroke: INK.ref });
    // Both subpaths' commands, not the first one's alone.
    expect(
      (object as unknown as { path: readonly unknown[] }).path.length,
    ).toBeGreaterThan(3);
    // 12% of 1080 is the glyph's box on its longer edge.
    expect(
      Math.round(Math.max(object.width, object.height) * object.scaleX),
    ).toBe(Math.round(1080 * 0.12));
    const centreX = (object.left ?? 0) + (object.width * object.scaleX) / 2;
    const centreY = (object.top ?? 0) + (object.height * object.scaleY) / 2;
    expect(Math.round(centreX)).toBe(ARTBOARD.width / 2);
    expect(Math.round(centreY)).toBe(ARTBOARD.height / 2);
  });
});
