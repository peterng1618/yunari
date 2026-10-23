import { describe, expect, it } from "vitest";
import { gradientCss } from "./gradient-css.js";

describe("the one gradient formula", () => {
  it("rotates the authored angle into CSS's clockwise angle", () => {
    expect(
      gradientCss(
        [
          { offset: 0, color: "#000" },
          { offset: 1, color: "#fff" },
        ],
        90,
      ),
    ).toBe("linear-gradient(0deg, #000 0%, #fff 100%)");
  });

  it("sorts the stops and rounds their offsets", () => {
    expect(
      gradientCss(
        [
          { offset: 0.375, color: "#fff" },
          { offset: 0, color: "#000" },
        ],
        0,
      ),
    ).toBe("linear-gradient(90deg, #000 0%, #fff 38%)");
  });

  it("collapses a paint no gradient can describe", () => {
    expect(gradientCss([], 0)).toBe("transparent");
    expect(gradientCss([{ offset: 0.5, color: "#102030" }], 0)).toBe("#102030");
  });
});
