import { describe, expect, it } from "vitest";
import {
  clampRenderScale,
  DEFAULT_RENDER_SCALE,
  MAX_BACKING_PIXELS,
  MAX_RENDER_SCALE,
} from "./render-scale.js";

/**
 * How large a chart's backing canvas may get.
 *
 * Two ceilings rather than one, because the original single cap was on the
 * wrong quantity: it bounded the oversample *factor*, while the memory it was
 * meant to bound is `width x height x factor^2`.
 */

describe("clampRenderScale", () => {
  it("caps the oversample factor", () => {
    expect(clampRenderScale(4, 300, 180)).toBe(MAX_RENDER_SCALE);
    expect(clampRenderScale(100, 300, 180)).toBe(MAX_RENDER_SCALE);
  });

  it("caps the backing store by area, not just by factor", () => {
    // The reason the factor alone is the wrong instrument: cost is
    // width x height x scale^2, so the same factor that is harmless on a badge
    // is not on a full-width chart. At the factor ceiling alone a 600x400 chart
    // would reach 2.16 M px.
    const scale = clampRenderScale(MAX_RENDER_SCALE, 600, 400);

    expect(scale).toBeLessThan(MAX_RENDER_SCALE);
    expect(scale).toBeGreaterThan(1);
    expect(600 * scale * (400 * scale)).toBeCloseTo(MAX_BACKING_PIXELS, 6);
  });

  it("agrees with the factor ceiling on the chart that was measured", () => {
    // The area ceiling is the factor ceiling restated in the unit that bounds
    // memory, derived from the 300x180 chart that was measured. On that chart
    // the two must give the same answer, or the restatement changed the policy.
    expect(clampRenderScale(MAX_RENDER_SCALE, 300, 180)).toBe(MAX_RENDER_SCALE);
  });

  it("delivers the default oversample to a chart the size the product ships", () => {
    // U9: the shipped starter's trends chart is 963x215, and the old budget
    // clamped it to 1.53x — the largest chart on the board, and the only one
    // below the default, which is what read as a visibly aliased graph. A
    // budget that makes the documented default untrue for the composition the
    // product ships is not a safety net, it is a bug.
    expect(clampRenderScale(DEFAULT_RENDER_SCALE, 963, 215)).toBe(
      DEFAULT_RENDER_SCALE,
    );
    // Every chart in the starter, at the default.
    const shipped: readonly (readonly [number, number])[] = [
      [230, 56],
      [240, 56],
      [218, 218],
      [430, 26],
      [430, 70],
    ];
    for (const [width, height] of shipped) {
      expect(clampRenderScale(DEFAULT_RENDER_SCALE, width, height)).toBe(
        DEFAULT_RENDER_SCALE,
      );
    }
  });

  it("never undersamples, however large the chart", () => {
    // Below 1 the backing store is smaller than the box it fills and the chart
    // is visibly soft, which buys memory with resolution the author asked for.
    // A chart too big to afford at 1x is a layout problem.
    // 2400x1200 is 2.88 M px at 1x — past the budget — so the cap stops
    // oversampling and goes no further.
    expect(clampRenderScale(2, 2400, 1200)).toBe(1);
    expect(clampRenderScale(2, 4000, 4000)).toBe(1);
  });

  it("passes through anything within both ceilings", () => {
    expect(clampRenderScale(1, 300, 180)).toBe(1);
    expect(clampRenderScale(2.75, 300, 180)).toBe(2.75);
  });

  it("refuses a scale that would produce a zero-sized canvas", () => {
    // `echarts.init` on a 0x0 element does not fail loudly, it just never
    // draws. Refuse rather than coerce: fall back to the default, never to 0.
    expect(clampRenderScale(0, 300, 180)).toBe(DEFAULT_RENDER_SCALE);
    expect(clampRenderScale(-2, 300, 180)).toBe(DEFAULT_RENDER_SCALE);
    expect(clampRenderScale(Number.NaN, 300, 180)).toBe(DEFAULT_RENDER_SCALE);
    expect(clampRenderScale(Number.POSITIVE_INFINITY, 300, 180)).toBe(
      DEFAULT_RENDER_SCALE,
    );
  });

  it("falls back to the factor ceiling when the box is unusable", () => {
    // The constructor refuses a zero-sized chart outright, so this only guards
    // the helper being called before a box is known.
    expect(clampRenderScale(4, 0, 0)).toBe(MAX_RENDER_SCALE);
    expect(clampRenderScale(2, Number.NaN, 180)).toBe(2);
  });
});
