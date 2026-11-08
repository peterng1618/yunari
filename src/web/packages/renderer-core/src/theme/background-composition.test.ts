import { describe, expect, it } from "vitest";
import {
  type BackgroundMediaGeometry,
  backgroundGeometry,
  blendRampStops,
  resolveBackgroundComposition,
} from "./background-composition.js";

const BOX = { width: 400, height: 100 } as const;
const SOURCE = { width: 160, height: 90 } as const;
const at = (geometry?: Partial<BackgroundMediaGeometry>) =>
  resolveBackgroundComposition(BOX, { anchor: "center" }, SOURCE, {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    ...geometry,
  });
const ZERO = { scale: 1, offsetX: 0, offsetY: 0 } as const;

describe("resolveBackgroundComposition", () => {
  it("keeps the simple background identical to the old cover at defaults", () => {
    const resolved = resolveBackgroundComposition(BOX, undefined, SOURCE);
    expect(resolved.region).toEqual({
      left: 0,
      top: 0,
      width: 400,
      height: 100,
    });
    expect(resolved.media?.dest).toEqual({
      left: 0,
      top: 0,
      width: 400,
      height: 100,
    });
    expect(resolved.media?.crop).toEqual({
      x: 0,
      y: 25,
      width: 160,
      height: 40,
    });
    expect(resolved.masks).toEqual([]);
  });

  it("grows the simple area about the centre, which is the old zoom", () => {
    const resolved = resolveBackgroundComposition(BOX, undefined, SOURCE, {
      ...ZERO,
      scale: 2,
    });
    expect(resolved.region).toEqual({
      left: -200,
      top: -50,
      width: 800,
      height: 200,
    });
    expect(resolved.media?.crop).toEqual({
      x: 40,
      y: 35,
      width: 80,
      height: 20,
    });
  });

  it("letterboxes a narrower source at the centre anchor", () => {
    const resolved = at();
    expect(resolved.region.left).toBeCloseTo(111.111, 3);
    expect(resolved.region.width).toBeCloseTo(177.778, 3);
    expect(resolved.region.height).toBe(100);
    expect(resolved.media?.crop).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 90,
    });
  });

  it("keeps the full width and clips top and bottom at scale 2", () => {
    const resolved = at({ scale: 2 });
    expect(resolved.media?.dest.left).toBeCloseTo(22.222, 3);
    expect(resolved.media?.dest.top).toBe(0);
    expect(resolved.media?.dest.width).toBeCloseTo(355.556, 3);
    expect(resolved.media?.dest.height).toBe(100);
    expect(resolved.media?.crop).toEqual({
      x: 0,
      y: 23,
      width: 160,
      height: 45,
    });
  });

  it("slides the centred area until it is flush and saturates", () => {
    const once = at({ offsetX: 1 });
    const far = at({ offsetX: 5 });
    expect(once.region.left).toBeCloseTo(222.222, 3);
    expect(far.region.left).toBeCloseTo(once.region.left, 6);
    expect(once.media?.dest.left).toBeCloseTo(222.222, 3);
  });

  it("grows an edge band across the box and keeps it flush", () => {
    const resolved = resolveBackgroundComposition(
      BOX,
      { anchor: "left", extent: 0.5 },
      SOURCE,
      { ...ZERO, scale: 2 },
    );
    expect(resolved.region).toEqual({
      left: 0,
      top: 0,
      width: 400,
      height: 100,
    });
    expect(resolved.media?.crop).toEqual({
      x: 0,
      y: 25,
      width: 160,
      height: 40,
    });
  });

  it("reports no media until the source size is known", () => {
    const resolved = resolveBackgroundComposition(
      BOX,
      { anchor: "center" },
      undefined,
      { ...ZERO, scale: 2 },
    );
    expect(resolved.media).toBeUndefined();
    expect(resolved.region).toEqual({
      left: -200,
      top: -50,
      width: 800,
      height: 200,
    });
  });

  it("moves the masks with the final area", () => {
    const resolved = resolveBackgroundComposition(
      BOX,
      { anchor: "center", fade: 0.25 },
      SOURCE,
      { ...ZERO, offsetX: 1 },
    );
    expect(resolved.masks).toHaveLength(2);
    expect(resolved.masks[0]?.x1).toBeCloseTo(222.222, 3);
    expect(resolved.masks[0]?.x2).toBeCloseTo(322.222, 3);
    expect(resolved.masks[1]?.x1).toBeCloseTo(400, 6);
  });

  it("centres a wide picture on its long edge and fills the two gaps", () => {
    const result = resolveBackgroundComposition(
      { width: 100, height: 400 },
      { anchor: "center", fade: 0.25 },
      { width: 160, height: 90 },
    );
    expect(result.region.top).toBeCloseTo(171.875, 3);
    expect(result.region.height).toBeCloseTo(56.25, 3);
    expect(result.masks[0]?.y1).toBeCloseTo(171.875, 3);
    expect(result.masks[0]?.y2).toBeCloseTo(228.125, 3);
    expect(result.masks[1]?.y1).toBeCloseTo(228.125, 3);
    expect(result.masks[1]?.y2).toBeCloseTo(171.875, 3);
  });

  it("covers the box when a centred picture has the box's aspect", () => {
    const result = resolveBackgroundComposition(
      { width: 800, height: 480 },
      { anchor: "center", fade: 0.1 },
      { width: 800, height: 480 },
    );
    expect(result.region).toEqual({
      left: 0,
      top: 0,
      width: 800,
      height: 480,
    });
    expect(result.masks).toEqual([]);
    expect(result.media?.crop).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 480,
    });
  });

  it("covers the box until the picture's size is known", () => {
    expect(resolveBackgroundComposition(BOX, { anchor: "center" })).toEqual({
      region: { left: 0, top: 0, width: 400, height: 100 },
      masks: [],
    });
  });

  it("anchors media to an edge as a band and fades where it meets the fill", () => {
    const left = resolveBackgroundComposition(BOX, {
      anchor: "left",
      extent: 0.35,
      fade: 0.25,
    });
    expect(left.region).toEqual({
      left: 0,
      top: 0,
      width: 140,
      height: 100,
    });
    // The fill is on the right, so the media fades at its own right edge.
    expect(left.masks).toEqual([
      { kind: "linear", x1: 140, y1: 0, x2: 40, y2: 0 },
    ]);

    const top = resolveBackgroundComposition(BOX, {
      anchor: "top",
      extent: 0.4,
      fade: 0.25,
    });
    expect(top.region).toEqual({ left: 0, top: 0, width: 400, height: 40 });
    expect(top.masks).toEqual([
      { kind: "linear", x1: 0, y1: 40, x2: 0, y2: 15 },
    ]);
  });

  it("mirrors the band for the opposite edges", () => {
    expect(
      resolveBackgroundComposition(BOX, {
        anchor: "right",
        extent: 0.25,
      }).region,
    ).toEqual({ left: 300, top: 0, width: 100, height: 100 });
    expect(
      resolveBackgroundComposition(BOX, {
        anchor: "bottom",
        extent: 0.25,
      }).region,
    ).toEqual({ left: 0, top: 75, width: 400, height: 25 });
  });

  it("covers the box at full extent, with a full-box ramp when faded", () => {
    expect(
      resolveBackgroundComposition(BOX, { anchor: "left", extent: 1 }),
    ).toEqual({
      region: { left: 0, top: 0, width: 400, height: 100 },
      masks: [],
    });
    expect(
      resolveBackgroundComposition(BOX, {
        anchor: "left",
        extent: 1,
        fade: 1,
      }),
    ).toEqual({
      region: { left: 0, top: 0, width: 400, height: 100 },
      masks: [{ kind: "linear", x1: 400, y1: 0, x2: 0, y2: 0 }],
    });
  });

  it("caps a fade longer than the band at the opposite edge", () => {
    expect(
      resolveBackgroundComposition(BOX, {
        anchor: "left",
        extent: 0.25,
        fade: 1,
      }).masks,
    ).toEqual([{ kind: "linear", x1: 100, y1: 0, x2: 0, y2: 0 }]);
  });
});

describe("backgroundGeometry", () => {
  it("defaults absent values and clamps authored ones", () => {
    expect(backgroundGeometry(undefined)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(
      backgroundGeometry({
        scale: 9,
        offsetX: -9,
        offsetY: Number.NaN,
      }),
    ).toEqual({ scale: 5, offsetX: -5, offsetY: 0 });
    expect(backgroundGeometry({ scale: 2, offsetX: 1, offsetY: -1 })).toEqual({
      scale: 2,
      offsetX: 1,
      offsetY: -1,
    });
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
