import { describe, expect, it } from "vitest";
import { placement } from "./background-media.js";

/**
 * The one placement owner: the DOM layer and the glass sampler both size the
 * media through this function, so these cases pin the arithmetic they share.
 * The media is always `cover`, so the placed rect is never smaller than the box
 * on either axis; translation is the only thing the author sets.
 */

const BOX = { width: 200, height: 100 };
const SOURCE = { width: 100, height: 100 };

describe("placement", () => {
  it("covers: max scale, cropped, centred", () => {
    expect(
      placement({ box: BOX, source: SOURCE, offsetX: 0, offsetY: 0 }),
    ).toEqual({ left: 0, top: -50, width: 200, height: 200 });
  });

  it("zooms into the pan the offset asks for", () => {
    // A 25% pan of a 200-wide box needs a 50-wide overhang, so the cover rect
    // grows from 200 to 300 across; the vertical floor (1.5×) is smaller.
    expect(
      placement({ box: BOX, source: SOURCE, offsetX: 0.25, offsetY: 0.25 }),
    ).toEqual({ left: 0, top: -75, width: 300, height: 300 });
  });

  it("reaches a full box of pan at 100%, stopping at the edge", () => {
    // ±100% is the whole box; the rect grows to 3× so the pan fits, and the
    // edge lands exactly on the box's.
    expect(
      placement({ box: BOX, source: SOURCE, offsetX: 0, offsetY: 1 }),
    ).toMatchObject({ top: 0 });
    expect(
      placement({ box: BOX, source: SOURCE, offsetX: 0, offsetY: -1 }),
    ).toMatchObject({ top: -200 });
  });

  it("pans a picture whose aspect already matches the box", () => {
    // The starter backdrop's shape: cover alone leaves no overhang, so the
    // offset is the only thing that enlarges the rect. 10% of the box needs
    // 1.2×, and the pan moves by exactly 10% instead of clamping to zero.
    const same = { width: 400, height: 200 };
    const resting = placement({
      box: BOX,
      source: same,
      offsetX: 0,
      offsetY: 0,
    });
    const panned = placement({
      box: BOX,
      source: same,
      offsetX: 0.1,
      offsetY: 0,
    });
    expect(resting).toEqual({ left: 0, top: 0, width: 200, height: 100 });
    // The rect grew by the 1.2× the pan needs, so the picture is visibly
    // zoomed and its crop is 20 px right of centre.
    expect(panned).toEqual({ left: 0, top: -10, width: 240, height: 120 });
    expect(panned.width).toBeGreaterThan(resting.width);
  });

  it("falls back to the box before the source has a size, offsets ignored", () => {
    // The load window has no intrinsic size to cover, so there is nothing to
    // translate either: placing the box, shifted, would leave a strip.
    expect(
      placement({ box: BOX, source: undefined, offsetX: 1, offsetY: -1 }),
    ).toEqual({ left: 0, top: 0, width: 200, height: 100 });
  });

  it("never exposes the box at any in-range offset", () => {
    // `cover` is the whole gap proof: the placed rect is at least the box on
    // both axes, so a translation can move the crop but never uncover colour.
    const boxes = [
      { width: 200, height: 100 },
      { width: 100, height: 200 },
      { width: 640, height: 200 },
    ];
    const sources = [
      { width: 100, height: 100 },
      { width: 12, height: 24 },
      { width: 400, height: 100 },
      { width: 1, height: 500 },
    ];
    for (const box of boxes) {
      for (const source of sources) {
        for (const offset of [-1, -0.5, 0, 0.5, 1]) {
          const rect = placement({
            box,
            source,
            offsetX: offset,
            offsetY: -offset,
          });
          expect(rect.width, "width covers the box").toBeGreaterThanOrEqual(
            box.width - 1e-9,
          );
          expect(rect.height, "height covers the box").toBeGreaterThanOrEqual(
            box.height - 1e-9,
          );
          expect(rect.left, "no gap on the left").toBeLessThanOrEqual(1e-9);
          expect(rect.top, "no gap on the top").toBeLessThanOrEqual(1e-9);
          expect(rect.left + rect.width).toBeGreaterThanOrEqual(
            box.width - 1e-9,
          );
          expect(rect.top + rect.height).toBeGreaterThanOrEqual(
            box.height - 1e-9,
          );
        }
      }
    }
  });

  it("refuses to produce NaN or negative sizes", () => {
    const zero = placement({
      box: { width: 0, height: 0 },
      source: SOURCE,
      offsetX: 0,
      offsetY: 0,
    });
    for (const value of Object.values(zero))
      expect(Number.isFinite(value)).toBe(true);
    const far = placement({
      box: BOX,
      source: SOURCE,
      offsetX: Number.NaN,
      offsetY: Number.POSITIVE_INFINITY,
    });
    for (const value of Object.values(far))
      expect(Number.isFinite(value)).toBe(true);
    expect(far.width).toBeGreaterThan(0);
    expect(far.height).toBeGreaterThan(0);
  });
});
