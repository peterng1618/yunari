import { describe, expect, it } from "vitest";
import { resolveBackgroundComposition } from "./background-composition.js";

const BOX = { width: 800, height: 480 } as const;

describe("resolveBackgroundComposition", () => {
  it("returns the whole box with no mask when there is no region", () => {
    expect(resolveBackgroundComposition(BOX, undefined)).toEqual({
      region: { left: 0, top: 0, width: 800, height: 480 },
      mask: undefined,
    });
  });

  it("insets the region and ramps from its left edge inward", () => {
    const result = resolveBackgroundComposition(BOX, {
      left: 0.25,
      blend: { shape: "linear", edge: "left", length: 0.1 },
    });

    expect(result.region).toEqual({
      left: 200,
      top: 0,
      width: 600,
      height: 480,
    });
    expect(result.mask).toEqual({
      kind: "linear",
      x1: 200,
      y1: 0,
      x2: 280,
      y2: 0,
    });
  });

  it("mirrors the ramp for the other three edges", () => {
    const region = { left: 0.25 };

    expect(
      resolveBackgroundComposition(BOX, {
        ...region,
        blend: { shape: "linear", edge: "right", length: 0.1 },
      }).mask,
    ).toEqual({ kind: "linear", x1: 800, y1: 0, x2: 720, y2: 0 });

    expect(
      resolveBackgroundComposition(BOX, {
        ...region,
        blend: { shape: "linear", edge: "top", length: 0.1 },
      }).mask,
    ).toEqual({ kind: "linear", x1: 200, y1: 0, x2: 200, y2: 48 });

    expect(
      resolveBackgroundComposition(BOX, {
        ...region,
        blend: { shape: "linear", edge: "bottom", length: 0.1 },
      }).mask,
    ).toEqual({ kind: "linear", x1: 200, y1: 480, x2: 200, y2: 432 });
  });

  it("fits a radial ramp to the region", () => {
    const result = resolveBackgroundComposition(BOX, {
      left: 0.1,
      top: 0.1,
      right: 0.1,
      bottom: 0.1,
      blend: { shape: "radial", length: 0.4 },
    });

    expect(result.mask).toEqual({
      kind: "radial",
      cx: 400,
      cy: 240,
      rx: 320,
      ry: 192,
      opaqueFraction: 0.6,
    });
  });

  it("caps a ramp longer than the region at the opposite edge", () => {
    expect(
      resolveBackgroundComposition(BOX, {
        left: 0.5,
        blend: { shape: "linear", edge: "left", length: 1 },
      }).mask,
    ).toEqual({ kind: "linear", x1: 400, y1: 0, x2: 800, y2: 0 });
  });
});
