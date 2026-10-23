import { describe, expect, it } from "vitest";
import {
  colorAt,
  type LinearGradientColor,
  mixHex,
  normalizePosition,
  resolveFlatColor,
  resolveThresholdColor,
  toLinearGradient,
} from "./fill.js";

describe("resolveThresholdColor", () => {
  // The band offset is an UPPER bound. These cases are the definition every
  // family shares, so a change here changes the meaning of authored themes.
  const bands = [
    { offset: 0.6, color: "#00ff00" },
    { offset: 0.85, color: "#ffaa00" },
    { offset: 1, color: "#ff0000" },
  ];

  it("treats a band offset as the top of its span", () => {
    expect(resolveThresholdColor(bands, 0)).toBe("#00ff00");
    expect(resolveThresholdColor(bands, 0.59)).toBe("#00ff00");
    expect(resolveThresholdColor(bands, 0.61)).toBe("#ffaa00");
    expect(resolveThresholdColor(bands, 0.9)).toBe("#ff0000");
  });

  it("keeps a value exactly on a boundary in the lower band", () => {
    // 80 °C is still "warm", not yet "hot". Off-by-one here would flip a
    // threshold indicator at rest on a round number, which is where authors
    // habitually put them.
    expect(resolveThresholdColor(bands, 0.6)).toBe("#00ff00");
    expect(resolveThresholdColor(bands, 0.85)).toBe("#ffaa00");
  });

  it("sorts unordered bands rather than trusting authoring order", () => {
    const shuffled = [bands[2]!, bands[0]!, bands[1]!];
    expect(resolveThresholdColor(shuffled, 0.5)).toBe("#00ff00");
    expect(resolveThresholdColor(shuffled, 0.95)).toBe("#ff0000");
  });

  it("extends the last band past the end instead of leaving a hole", () => {
    const short = [{ offset: 0.5, color: "#00ff00" }];
    expect(resolveThresholdColor(short, 0.99)).toBe("#00ff00");
  });

  it("clamps a position outside 0–1", () => {
    expect(resolveThresholdColor(bands, -5)).toBe("#00ff00");
    expect(resolveThresholdColor(bands, 5)).toBe("#ff0000");
  });

  it("returns transparent for no bands", () => {
    expect(resolveThresholdColor([], 0.5)).toBe("transparent");
  });
});

describe("resolveFlatColor", () => {
  it("returns a solid colour unchanged", () => {
    expect(resolveFlatColor({ kind: "solid", color: "#123456" }, 0.3)).toBe(
      "#123456",
    );
  });

  it("resolves a threshold band at the position", () => {
    const fill = {
      kind: "thresholds" as const,
      bands: [
        { offset: 0.5, color: "#00ff00" },
        { offset: 1, color: "#ff0000" },
      ],
    };
    expect(resolveFlatColor(fill, 0.75)).toBe("#ff0000");
  });

  it("samples a gradient at the position rather than approximating it", () => {
    const fill = {
      kind: "gradient" as const,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    };
    expect(resolveFlatColor(fill, 0.5)).toBe("#808080");
  });
});

describe("toLinearGradient", () => {
  it("maps each direction to the expected axis", () => {
    const stops = [
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#ffffff" },
    ];

    const right = toLinearGradient(stops, "to-right") as LinearGradientColor;
    expect([right.x, right.y, right.x2, right.y2]).toEqual([0, 0, 1, 0]);

    const down = toLinearGradient(stops, "to-bottom") as LinearGradientColor;
    expect([down.x, down.y, down.x2, down.y2]).toEqual([0, 0, 0, 1]);

    // A bar grows away from the axis, so its gradient starts at the bottom.
    const up = toLinearGradient(stops, "to-top") as LinearGradientColor;
    expect([up.x, up.y, up.x2, up.y2]).toEqual([0, 1, 0, 0]);
  });

  it("collapses a degenerate gradient to a plain colour string", () => {
    // Engines disagree about a gradient with no span; a string has exactly one
    // interpretation.
    expect(toLinearGradient([], "to-right")).toBe("transparent");
    expect(
      toLinearGradient([{ offset: 0.3, color: "#abcdef" }], "to-right"),
    ).toBe("#abcdef");
  });

  it("sorts and clamps stops", () => {
    const result = toLinearGradient(
      [
        { offset: 2, color: "#ffffff" },
        { offset: -1, color: "#000000" },
      ],
      "to-right",
    ) as LinearGradientColor;

    expect(result.colorStops).toEqual([
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#ffffff" },
    ]);
  });
});

describe("colorAt", () => {
  const stops = [
    { offset: 0.25, color: "#000000" },
    { offset: 0.75, color: "#ffffff" },
  ];

  it("interpolates between stops", () => {
    expect(colorAt(stops, 0.5)).toBe("#808080");
  });

  it("clamps to the nearest endpoint outside the authored span", () => {
    expect(colorAt(stops, 0)).toBe("#000000");
    expect(colorAt(stops, 1)).toBe("#ffffff");
  });

  it("handles a zero-width span without dividing by zero", () => {
    const coincident = [
      { offset: 0.5, color: "#112233" },
      { offset: 0.5, color: "#445566" },
    ];
    expect(colorAt(coincident, 0.5)).toBe("#112233");
  });

  it("returns transparent for no stops", () => {
    expect(colorAt([], 0.5)).toBe("transparent");
  });
});

describe("mixHex", () => {
  it("mixes shorthand and full hex alike", () => {
    expect(mixHex("#000", "#fff", 0.5)).toBe("#808080");
    expect(mixHex("#ff0000", "#0000ff", 1)).toBe("#0000ff");
  });

  it("mixes colours beyond hex, and falls back for one it cannot parse", () => {
    // Emitting an invalid colour would paint nothing; returning an endpoint at
    // least keeps the element visible.
    expect(mixHex("rgb(0 0 0)", "#ffffff", 0.2)).toBe("#333333");
    expect(mixHex("nope", "#ffffff", 0.2)).toBe("nope");
    expect(mixHex("nope", "#ffffff", 0.8)).toBe("#ffffff");
  });
});

describe("normalizePosition", () => {
  it("normalises within the range and clamps outside it", () => {
    expect(normalizePosition(50, 0, 100)).toBe(0.5);
    expect(normalizePosition(-10, 0, 100)).toBe(0);
    expect(normalizePosition(150, 0, 100)).toBe(1);
  });

  it("handles a non-zero-based range", () => {
    expect(normalizePosition(40, 20, 60)).toBe(0.5);
  });

  it("returns 0 for a zero-width range instead of NaN", () => {
    // A NaN would propagate into a colour lookup and paint nothing.
    expect(normalizePosition(5, 5, 5)).toBe(0);
  });
});
