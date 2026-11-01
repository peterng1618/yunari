import type { Artboard } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { circleConversion } from "./artboard-conversion.js";

describe("circleConversion", () => {
  it("inscribes the short edge and scales the scene onto the disc", () => {
    const conversion = circleConversion({ width: 1920, height: 1080 });

    expect(conversion.artboard).toEqual({
      width: 1080,
      height: 1080,
      shape: "circle",
    });
    // The scene diagonal becomes the disc diameter, so every point keeps its
    // place on the disc rather than being cropped by the new edge.
    expect(conversion.scale).toBe(1080 / Math.hypot(1920, 1080));
  });

  it("converts a square artboard to itself", () => {
    const conversion = circleConversion({ width: 1080, height: 1080 });

    expect(conversion.artboard).toEqual({
      width: 1080,
      height: 1080,
      shape: "circle",
    });
    expect(conversion.scale).toBe(1080 / Math.hypot(1080, 1080));
  });

  it("returns a circle artboard unchanged", () => {
    const artboard: Artboard = { width: 1080, height: 1080, shape: "circle" };

    expect(circleConversion(artboard)).toEqual({ artboard, scale: 1 });
  });
});
