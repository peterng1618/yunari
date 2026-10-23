import { describe, expect, it } from "vitest";
import { formatColor, fromHsv, parseColor, toHsv } from "./color.js";

describe("parseColor", () => {
  it("parses the forms the field accepts", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("rgb(16 32 48)")).toEqual({ r: 16, g: 32, b: 48, a: 1 });
    expect(parseColor("hsl(0 100% 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("refuses what is not a colour", () => {
    expect(parseColor("nope")).toBeUndefined();
    expect(parseColor("#12345")).toBeUndefined();
    expect(parseColor("")).toBeUndefined();
  });
});

describe("formatColor", () => {
  it("keeps alpha only when the value is translucent", () => {
    expect(formatColor(parseColor("#102030ff")!)).toBe("#102030");
    expect(formatColor(parseColor("#081523d9")!)).toBe("#081523d9");
  });

  it("round-trips a translucent value", () => {
    const rgba = parseColor("#081523d9")!;
    expect(rgba.a).toBeCloseTo(217 / 255, 5);
    expect(formatColor(rgba)).toBe("#081523d9");
  });
});

describe("hsv", () => {
  it("converts pure colours in both directions", () => {
    const red = toHsv({ r: 255, g: 0, b: 0, a: 1 });
    expect(red.h).toBeCloseTo(0, 5);
    expect(red.s).toBeCloseTo(1, 5);
    expect(red.v).toBeCloseTo(1, 5);
    expect(formatColor(fromHsv({ h: 120, s: 1, v: 1, a: 1 }))).toBe("#00ff00");
  });

  it("treats a grey as zero saturation and a finite hue", () => {
    const grey = toHsv({ r: 128, g: 128, b: 128, a: 1 });
    expect(grey.s).toBeCloseTo(0, 5);
    expect(Number.isFinite(grey.h)).toBe(true);
  });

  it("keeps alpha through both directions", () => {
    const translucent = fromHsv({ h: 200, s: 0.5, v: 0.5, a: 0.5 });
    expect(translucent.a).toBe(0.5);
    expect(toHsv(translucent).a).toBe(0.5);
  });
});
