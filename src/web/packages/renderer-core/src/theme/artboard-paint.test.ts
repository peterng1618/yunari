import { describe, expect, it } from "vitest";
import { cssArtboardPaint } from "./artboard-paint.js";

const gradient = {
  kind: "gradient" as const,
  angle: 0,
  stops: [
    { offset: 0, color: "#102030" },
    { offset: 1, color: "#d0e0f0" },
  ],
};

describe("cssArtboardPaint", () => {
  it("converts a structured solid palette token", () => {
    expect(cssArtboardPaint({ kind: "solid", color: "#102030" })).toBe(
      "#102030",
    );
  });

  it("uses the corresponding CSS gradient for letterbox bars", () => {
    expect(cssArtboardPaint(gradient)).toBe(
      "linear-gradient(90deg, #102030 0%, #d0e0f0 100%)",
    );
  });

  it("points a rotated gradient the way the CSS form does", () => {
    // The stored angle is `90 - cssDegrees`, so 90 is CSS's `0deg`: the first
    // stop at the bottom, the last at the top.
    expect(cssArtboardPaint({ ...gradient, angle: 90 })).toBe(
      "linear-gradient(0deg, #102030 0%, #d0e0f0 100%)",
    );
  });

  it("passes Fabric-compatible solid colors through unchanged", () => {
    expect(cssArtboardPaint("rgb(16 32 48)")).toBe("rgb(16 32 48)");
  });

  it("answers nothing for a paint neither form can draw", () => {
    expect(cssArtboardPaint(undefined)).toBeUndefined();
    expect(cssArtboardPaint({ kind: "gradient" })).toBeUndefined();
  });
});
