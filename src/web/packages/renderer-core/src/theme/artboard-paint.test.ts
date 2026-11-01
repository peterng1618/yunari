import { describe, expect, it } from "vitest";
import { cssArtboardPaint, cssArtboardPaintMapped } from "./artboard-paint.js";

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

describe("cssArtboardPaintMapped", () => {
  const box = { left: 0, top: 0, width: 200, height: 100 };

  it("keeps a solid paint, which has no line to map", () => {
    expect(
      cssArtboardPaintMapped("#102030", box, {
        left: 50,
        top: 0,
        width: 100,
        height: 100,
      }),
    ).toBe("#102030");
  });

  it("maps the plate's line across the element, not the element's own", () => {
    // A 100px board centred in a 200px element: its line spans the middle half,
    // so the plate's endpoints land at 25% and 75% of the element's line.
    expect(
      cssArtboardPaintMapped(gradient, box, {
        left: 50,
        top: 0,
        width: 100,
        height: 100,
      }),
    ).toBe("linear-gradient(90deg, #102030 25%, #d0e0f0 75%)");
  });

  it("carries a board that is not centred to its own position", () => {
    // The board's line starts at the element's centre, so only its far half
    // reaches the element's end.
    expect(
      cssArtboardPaintMapped(gradient, box, {
        left: 100,
        top: 0,
        width: 100,
        height: 100,
      }),
    ).toBe("linear-gradient(90deg, #102030 50%, #d0e0f0 100%)");
  });

  it("clamps a board that overflows the element", () => {
    // The plate's line is twice the element's, so its ends are outside any
    // pixel the element draws; the gradient's own clamping is the answer.
    expect(
      cssArtboardPaintMapped(
        gradient,
        { ...box, width: 100 },
        {
          left: -50,
          top: 0,
          width: 200,
          height: 100,
        },
      ),
    ).toBe("linear-gradient(90deg, #102030 0%, #d0e0f0 100%)");
  });

  it("falls back to the bare form for a degenerate element", () => {
    expect(
      cssArtboardPaintMapped(
        gradient,
        { ...box, width: 0 },
        {
          left: 0,
          top: 0,
          width: 100,
          height: 100,
        },
      ),
    ).toBe(cssArtboardPaint(gradient));
  });
});
