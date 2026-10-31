import { Gradient } from "fabric/es";
import { describe, expect, it } from "vitest";
import { artboardPaintKey, fabricArtboardPaint } from "./artboard-paint.js";

describe("artboard paint key", () => {
  it("matches only paints that produce the same Fabric paint", () => {
    expect(artboardPaintKey("#102030")).toBe(artboardPaintKey("#102030"));
    expect(artboardPaintKey({ kind: "solid", color: "#102030" })).toBe(
      artboardPaintKey("#102030").replace("s:", "o:"),
    );
    expect(
      artboardPaintKey({
        kind: "gradient",
        angle: 0,
        stops: [
          { offset: 0, color: "#102030" },
          { offset: 1, color: "#d0e0f0" },
        ],
      }),
    ).toBe(
      artboardPaintKey({
        kind: "gradient",
        angle: 0,
        stops: [
          { offset: 0, color: "#102030" },
          { offset: 1, color: "#d0e0f0" },
        ],
      }),
    );
  });

  it("separates paints whose colour or angle differs", () => {
    const stops = [
      { offset: 0, color: "#102030" },
      { offset: 1, color: "#d0e0f0" },
    ];
    const base = artboardPaintKey({ kind: "gradient", angle: 0, stops });

    expect(artboardPaintKey({ kind: "gradient", angle: 90, stops })).not.toBe(
      base,
    );
    expect(
      artboardPaintKey({
        kind: "gradient",
        angle: 0,
        stops: [{ offset: 0, color: "#000000" }, stops[1]!],
      }),
    ).not.toBe(base);
    expect(artboardPaintKey(undefined)).toBe("none");
  });
});

describe("artboard paint", () => {
  const gradient = {
    kind: "gradient" as const,
    angle: 0,
    stops: [
      { offset: 0, color: "#102030" },
      { offset: 1, color: "#d0e0f0" },
    ],
  };

  it("converts a palette gradient to Fabric pixels across the artboard", () => {
    const paint = fabricArtboardPaint(gradient, 800, 600);

    expect(paint).toBeInstanceOf(Gradient);
    expect(paint).toMatchObject({
      type: "linear",
      gradientUnits: "pixels",
      coords: { x1: 0, y1: 300, x2: 800, y2: 300 },
      colorStops: gradient.stops,
    });
  });

  it("converts a structured solid palette token", () => {
    expect(fabricArtboardPaint({ kind: "solid", color: "#102030" }, 1, 1)).toBe(
      "#102030",
    );
  });

  it("points a rotated gradient the way the CSS form does", () => {
    // The stored angle is `90 - cssDegrees`, so 90 is CSS's `0deg`: the first
    // stop at the bottom, the last at the top. The canvas forms used `sin` for
    // y in screen coordinates, which mirrored every non-horizontal angle
    // against the CSS preview and the editor's own gradient track. The CSS
    // form's own cases live in renderer-core, where the conversion now lives.
    const vertical = { ...gradient, angle: 90 };

    expect(fabricArtboardPaint(vertical, 800, 600)).toMatchObject({
      coords: { x1: 400, y1: 600, x2: 400, y2: 0 },
    });
  });

  it("passes Fabric-compatible solid colors through unchanged", () => {
    expect(fabricArtboardPaint("#102030", 1, 1)).toBe("#102030");
  });
});
