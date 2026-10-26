import { describe, expect, it } from "vitest";
import {
  type ContentFit,
  computeArtboardTransform,
  documentToViewport,
  isFullyVisible,
  toCssTransform,
  viewportToDocument,
} from "./artboard.js";

/** A 16:9 artboard, the common dashboard shape. */
const wide = { width: 1920, height: 1080 };

describe("computeArtboardTransform — contain", () => {
  it("uses the smaller ratio so the whole design fits", () => {
    // Viewport is relatively taller than the artboard, so width constrains.
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 960, height: 1080 },
      contentFit: "contain",
    });

    expect(t.scale).toBe(0.5); // min(960/1920, 1080/1080) = min(0.5, 1)
  });

  it("centres the design exactly, leaving a bar on each edge of one axis", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 960, height: 1080 },
      contentFit: "contain",
    });

    // Scaled to 960x540 inside a 960x1080 viewport: 540 left over vertically.
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(270);
    expect(t.bars).toEqual({ x: 0, y: 270 });
  });

  it("never crops", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 300, height: 2000 },
      contentFit: "contain",
    });

    expect(t.crop).toEqual({ x: 0, y: 0 });
    expect(isFullyVisible(t)).toBe(true);
  });

  it("scales below 1 when the design is larger than the viewport", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 480, height: 270 },
      contentFit: "contain",
    });

    expect(t.scale).toBe(0.25);
    expect(t.bars).toEqual({ x: 0, y: 0 }); // exact aspect match, no leftover
  });

  it("defaults to contain when no contentFit is given", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 960, height: 1080 },
    });

    expect(t.contentFit).toBe("contain");
    expect(t.scale).toBe(0.5);
  });
});

describe("computeArtboardTransform — cover", () => {
  it("uses the larger ratio so the design fills the viewport", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 960, height: 1080 },
      contentFit: "cover",
    });

    expect(t.scale).toBe(1); // max(0.5, 1)
  });

  it("reports the hidden region in document units and offsets negatively", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 960, height: 1080 },
      contentFit: "cover",
    });

    // At scale 1 the 1920-wide design sits in a 960-wide viewport: 960 hidden,
    // 480 off each edge. Document units == viewport pixels only because scale is 1.
    expect(t.offsetX).toBe(-480);
    expect(t.crop).toEqual({ x: 480, y: 0 });
  });

  it("converts crop into document units, not viewport pixels", () => {
    // scale = max(1000/100, 1000/1000) = 10. Scaled height 10000 in a 1000
    // viewport: 9000px hidden = 4500px per edge = 450 DOCUMENT units at scale 10.
    const t = computeArtboardTransform({
      artboard: { width: 100, height: 1000 },
      viewport: { width: 1000, height: 1000 },
      contentFit: "cover",
    });

    expect(t.scale).toBe(10);
    expect(t.offsetY).toBe(-4500);
    expect(t.crop.y).toBe(450);
  });

  it("never reports bars", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 960, height: 1080 },
      contentFit: "cover",
    });

    expect(t.bars).toEqual({ x: 0, y: 0 });
    expect(isFullyVisible(t)).toBe(false);
  });

  it("scales above 1 when the design is smaller than the viewport", () => {
    const t = computeArtboardTransform({
      artboard: { width: 100, height: 100 },
      viewport: { width: 400, height: 800 },
      contentFit: "cover",
    });

    expect(t.scale).toBe(8); // max(4, 8)
    expect(t.crop.x).toBeGreaterThan(0);
    expect(t.crop.y).toBe(0);
  });
});

describe("computeArtboardTransform — invariants that hold in both modes", () => {
  it.each<ContentFit>(["contain", "cover"])(
    "leaves at most one axis non-zero for bars and crop (%s)",
    (contentFit) => {
      const viewports = [
        { width: 100, height: 1000 },
        { width: 1000, height: 100 },
        { width: 333, height: 777 },
        { width: 1920, height: 1080 },
        { width: 1, height: 4000 },
      ];

      for (const viewport of viewports) {
        const t = computeArtboardTransform({
          artboard: wide,
          viewport,
          contentFit,
        });

        // If both axes had slack (or both overflowed) the scale would be wrong.
        expect(Math.min(t.bars.x, t.bars.y)).toBeCloseTo(0, 9);
        expect(Math.min(t.crop.x, t.crop.y)).toBeCloseTo(0, 9);
      }
    },
  );

  it("agrees between modes when the aspect ratios match exactly", () => {
    const viewport = { width: 640, height: 360 }; // also 16:9

    const contain = computeArtboardTransform({
      artboard: wide,
      viewport,
      contentFit: "contain",
    });
    const cover = computeArtboardTransform({
      artboard: wide,
      viewport,
      contentFit: "cover",
    });

    expect(contain.scale).toBe(cover.scale);
    expect(contain.offsetX).toBe(cover.offsetX);
    expect(contain.offsetY).toBe(cover.offsetY);
    expect(contain.bars).toEqual({ x: 0, y: 0 });
    expect(cover.crop).toEqual({ x: 0, y: 0 });

    // The one case where cover shows everything.
    expect(isFullyVisible(cover)).toBe(true);
  });

  it.each<ContentFit>(["contain", "cover"])(
    "preserves fractional offsets rather than rounding (%s)",
    (contentFit) => {
      // 1081 is odd, so centring yields a .5 offset. Rounding it would
      // reintroduce the per-frame drift this deliberately avoids.
      const t = computeArtboardTransform({
        artboard: { width: 100, height: 100 },
        viewport: { width: 100, height: 1081 },
        contentFit,
      });

      const fractional = [t.offsetX, t.offsetY].some(
        (v) => !Number.isInteger(v),
      );
      expect(fractional).toBe(true);
    },
  );

  it.each<ContentFit>(["contain", "cover"])(
    "handles an extreme aspect ratio (%s)",
    (contentFit) => {
      const t = computeArtboardTransform({
        artboard: { width: 1, height: 1000 },
        viewport: { width: 1000, height: 1 },
        contentFit,
      });

      expect(Number.isFinite(t.scale)).toBe(true);
      expect(t.scale).toBeGreaterThan(0);
      expect(Number.isFinite(t.offsetX)).toBe(true);
      expect(Number.isFinite(t.offsetY)).toBe(true);
    },
  );
});

describe("computeArtboardTransform — degenerate and invalid input", () => {
  it.each([
    ["zero width", { width: 0, height: 100 }],
    ["zero height", { width: 100, height: 0 }],
    ["both zero", { width: 0, height: 0 }],
    ["negative width", { width: -100, height: 100 }],
  ])("returns scale 0 without NaN for a %s viewport", (_label, viewport) => {
    const t = computeArtboardTransform({ artboard: wide, viewport });

    expect(t.scale).toBe(0);
    expect(t.isDegenerate).toBe(true);
    expect(Number.isNaN(t.offsetX)).toBe(false);
    expect(Number.isNaN(t.offsetY)).toBe(false);
    expect(t.bars).toEqual({ x: 0, y: 0 });
    expect(t.crop).toEqual({ x: 0, y: 0 });
    expect(isFullyVisible(t)).toBe(false);
  });

  it.each([
    ["zero width", { width: 0, height: 100 }],
    ["zero height", { width: 100, height: 0 }],
    ["negative height", { width: 100, height: -1 }],
  ])("throws for a %s artboard", (_label, artboard) => {
    // An invalid document is a programming error, not a render state.
    expect(() =>
      computeArtboardTransform({
        artboard,
        viewport: { width: 100, height: 100 },
      }),
    ).toThrow(RangeError);
  });

  it.each([
    [
      "artboard width",
      { artboard: { width: NaN, height: 100 }, viewport: wide },
    ],
    [
      "artboard height",
      { artboard: { width: 100, height: Infinity }, viewport: wide },
    ],
    [
      "viewport width",
      { artboard: wide, viewport: { width: NaN, height: 100 } },
    ],
    [
      "viewport height",
      { artboard: wide, viewport: { width: 100, height: -Infinity } },
    ],
  ])("throws for non-finite %s", (_label, input) => {
    expect(() => computeArtboardTransform(input)).toThrow(RangeError);
  });
});

describe("point mapping", () => {
  it.each<ContentFit>(["contain", "cover"])(
    "round-trips exactly (%s)",
    (contentFit) => {
      const t = computeArtboardTransform({
        artboard: wide,
        viewport: { width: 837, height: 1131 },
        contentFit,
      });

      for (const point of [
        { x: 0, y: 0 },
        { x: 1920, y: 1080 },
        { x: 960, y: 540 },
        { x: 123.456, y: 789.012 },
        { x: -50, y: -50 }, // outside the artboard is still a valid coordinate
      ]) {
        const roundTripped = viewportToDocument(
          t,
          documentToViewport(t, point),
        );
        expect(roundTripped.x).toBeCloseTo(point.x, 9);
        expect(roundTripped.y).toBeCloseTo(point.y, 9);
      }
    },
  );

  it("maps the artboard origin to the transform offset", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 960, height: 1080 },
      contentFit: "contain",
    });

    expect(documentToViewport(t, { x: 0, y: 0 })).toEqual({ x: 0, y: 270 });
  });

  it("maps the artboard centre to the viewport centre", () => {
    const viewport = { width: 837, height: 1131 };
    const t = computeArtboardTransform({
      artboard: wide,
      viewport,
      contentFit: "contain",
    });

    const centre = documentToViewport(t, {
      x: wide.width / 2,
      y: wide.height / 2,
    });

    expect(centre.x).toBeCloseTo(viewport.width / 2, 9);
    expect(centre.y).toBeCloseTo(viewport.height / 2, 9);
  });

  it("returns the origin for a degenerate transform rather than dividing by zero", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 0, height: 0 },
    });

    expect(viewportToDocument(t, { x: 100, y: 100 })).toEqual({ x: 0, y: 0 });
  });
});

describe("toCssTransform", () => {
  it("translates before scaling so offsets stay in viewport pixels", () => {
    const t = computeArtboardTransform({
      artboard: wide,
      viewport: { width: 960, height: 1080 },
      contentFit: "contain",
    });

    expect(toCssTransform(t)).toBe("translate(0px, 270px) scale(0.5)");
  });
});

describe("computeArtboardTransform — rotation and shape", () => {
  it("keeps today's numbers at rotation 0", () => {
    const t = computeArtboardTransform({
      artboard: { width: 1600, height: 900 },
      viewport: { width: 800, height: 600 },
    });

    expect(t.matrix).toEqual([0.5, 0, 0, 0.5, 0, 75]);
    expect(t.rotation).toBe(0);
  });

  it("rotates then contain-fits a 90 degree rect display", () => {
    const t = computeArtboardTransform({
      artboard: { width: 1600, height: 900 },
      viewport: { width: 600, height: 800 },
      rotation: 90,
    });

    expect(t.scale).toBeCloseTo(0.5, 9);
    expect(t.matrix[0]).toBeCloseTo(0, 9);
    expect(t.matrix[1]).toBeCloseTo(0.5, 9);
    expect(t.matrix[2]).toBeCloseTo(-0.5, 9);
    expect(t.matrix[3]).toBeCloseTo(0, 9);
    expect(t.matrix[5]).toBeCloseTo(0, 9);
    // 900x1600 rotated box scaled to 450x800 in a 600x800 viewport: the
    // letterbox is left and right, as the spec's acceptance case states.
    expect(t.bars.x).toBeCloseTo(75, 9);
    expect(t.bars.y).toBeCloseTo(0, 9);
  });

  it("inscribes every artboard corner on a circle display", () => {
    const t = computeArtboardTransform({
      artboard: { width: 1600, height: 900 },
      viewport: { width: 600, height: 800 },
      shape: "circle",
      rotation: 45,
    });

    const radius = 300;
    for (const [x, y] of [
      [0, 0],
      [1600, 0],
      [1600, 900],
      [0, 900],
    ] as const) {
      const p = documentToViewport(t, { x, y });
      expect(Math.hypot(p.x - 300, p.y - 400)).toBeCloseTo(radius, 6);
    }
  });

  it("keeps the circle scale independent of its angle", () => {
    const at = (rotation: number) =>
      computeArtboardTransform({
        artboard: { width: 1600, height: 900 },
        viewport: { width: 600, height: 800 },
        shape: "circle",
        rotation,
      }).scale;
    expect(at(0)).toBeCloseTo(at(45), 12);
    expect(at(0)).toBeCloseTo(600 / Math.hypot(1600, 900), 12);
  });

  it.each([
    ["rect 45", { rotation: 45 }],
    ["rect 360", { rotation: 360 }],
    ["negative", { rotation: -90 }],
    ["fraction", { rotation: 90.5 }],
    ["circle 360", { shape: "circle" as const, rotation: 360 }],
  ])("refuses %s", (_name, extra) => {
    expect(() =>
      computeArtboardTransform({
        artboard: { width: 1600, height: 900 },
        viewport: { width: 600, height: 800 },
        ...extra,
      }),
    ).toThrow(RangeError);
  });

  it("round-trips a rotated point", () => {
    const t = computeArtboardTransform({
      artboard: { width: 1600, height: 900 },
      viewport: { width: 600, height: 800 },
      rotation: 90,
    });
    const point = { x: 123, y: 456 };
    expect(viewportToDocument(t, documentToViewport(t, point))).toEqual(point);
  });
});
