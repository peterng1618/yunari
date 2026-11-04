import { describe, expect, it } from "vitest";
import {
  blendRampStops,
  resolveBackgroundComposition,
} from "./background-composition.js";

const BOX = { width: 800, height: 480 } as const;

describe("resolveBackgroundComposition", () => {
  it("covers the whole box with no mask when no composition is authored", () => {
    expect(resolveBackgroundComposition(BOX, undefined)).toEqual({
      region: { left: 0, top: 0, width: 800, height: 480 },
      masks: [],
    });
  });

  it("anchors media to an edge as a band and fades where it meets the fill", () => {
    const left = resolveBackgroundComposition(BOX, {
      anchor: "left",
      extent: 0.35,
      fade: 0.1,
    });
    expect(left.region).toEqual({
      left: 0,
      top: 0,
      width: 280,
      height: 480,
    });
    // The fill is on the right, so the media fades at its own right edge.
    expect(left.masks).toEqual([
      { kind: "linear", x1: 280, y1: 0, x2: 200, y2: 0 },
    ]);

    const top = resolveBackgroundComposition(BOX, {
      anchor: "top",
      extent: 0.4,
      fade: 0.1,
    });
    expect(top.region).toEqual({ left: 0, top: 0, width: 800, height: 192 });
    expect(top.masks).toEqual([
      { kind: "linear", x1: 0, y1: 192, x2: 0, y2: 144 },
    ]);
  });

  it("mirrors the band for the opposite edges", () => {
    expect(
      resolveBackgroundComposition(BOX, {
        anchor: "right",
        extent: 0.25,
      }).region,
    ).toEqual({ left: 600, top: 0, width: 200, height: 480 });
    expect(
      resolveBackgroundComposition(BOX, {
        anchor: "bottom",
        extent: 0.25,
      }).region,
    ).toEqual({ left: 0, top: 360, width: 800, height: 120 });
  });

  it("centres a wide picture on its long edge and fills the two gaps", () => {
    // 1600×900 is wider than the box, so the picture's width fits the box and
    // the gaps are above and below it.
    const result = resolveBackgroundComposition(
      BOX,
      { anchor: "center", fade: 0.1 },
      { width: 1600, height: 900 },
    );
    expect(result.region).toEqual({
      left: 0,
      top: 15,
      width: 800,
      height: 450,
    });
    expect(result.masks).toEqual([
      { kind: "linear", x1: 0, y1: 15, x2: 0, y2: 63 },
      { kind: "linear", x1: 0, y1: 465, x2: 0, y2: 417 },
    ]);
  });

  it("centres a tall picture on its long edge and fills the sides", () => {
    const result = resolveBackgroundComposition(
      BOX,
      { anchor: "center", fade: 0.1 },
      { width: 900, height: 1600 },
    );
    expect(result.region).toEqual({
      left: 265,
      top: 0,
      width: 270,
      height: 480,
    });
    expect(result.masks).toEqual([
      { kind: "linear", x1: 265, y1: 0, x2: 345, y2: 0 },
      { kind: "linear", x1: 535, y1: 0, x2: 455, y2: 0 },
    ]);
  });

  it("covers the box when a centred picture has the box's aspect", () => {
    expect(
      resolveBackgroundComposition(
        BOX,
        { anchor: "center", fade: 0.1 },
        { width: 800, height: 480 },
      ),
    ).toEqual({
      region: { left: 0, top: 0, width: 800, height: 480 },
      masks: [],
    });
  });

  it("covers the box until the picture's size is known", () => {
    expect(resolveBackgroundComposition(BOX, { anchor: "center" })).toEqual({
      region: { left: 0, top: 0, width: 800, height: 480 },
      masks: [],
    });
  });

  it("caps a fade longer than the band at the opposite edge", () => {
    expect(
      resolveBackgroundComposition(BOX, {
        anchor: "left",
        extent: 0.25,
        fade: 1,
      }).masks,
    ).toEqual([{ kind: "linear", x1: 200, y1: 0, x2: 0, y2: 0 }]);
  });
});

describe("blendRampStops", () => {
  it("eases from transparent to opaque without a crease at either end", () => {
    const stops = blendRampStops();
    expect(stops.length).toBeGreaterThan(2);
    expect(stops[0]).toMatchObject({ offset: 0, alpha: 0 });
    expect(stops.at(-1)).toMatchObject({ offset: 1, alpha: 1 });
    for (let index = 1; index < stops.length; index++) {
      expect(stops[index]!.alpha).toBeGreaterThan(stops[index - 1]!.alpha);
    }
    // A smoothstep is symmetric and flatter than a straight line near both
    // ends, which is what removes the visible seam.
    const quarter = stops.find((stop) => stop.offset === 2 / 7);
    expect(quarter?.alpha).toBeCloseTo(0.145, 2);
  });
});
