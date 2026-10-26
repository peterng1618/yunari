import { describe, expect, it } from "vitest";
import { defaultTypeSize } from "./type-size.js";

describe("defaultTypeSize", () => {
  it("scales each role from the artboard height", () => {
    // 1080 is the reference artboard; 2160 is twice it in both axes.
    expect(defaultTypeSize("heading", 1080)).toBe(72);
    expect(defaultTypeSize("body", 1080)).toBe(16);
    expect(defaultTypeSize("mono", 1080)).toBe(14);
    expect(defaultTypeSize("heading", 2160)).toBe(144);
    expect(defaultTypeSize("body", 2160)).toBe(32);
    expect(defaultTypeSize("mono", 2160)).toBe(28);
  });

  it("gives an unroled token the body ratio", () => {
    expect(defaultTypeSize("custom", 1080)).toBe(16);
    expect(defaultTypeSize("", 1080)).toBe(16);
    // The fallback is by ratio, not by a pinned number.
    expect(defaultTypeSize("custom", 2160)).toBe(32);
  });

  it("never returns a size below 1", () => {
    // A zero-height artboard must not yield a zero font size, which Fabric
    // divides by when it converts tracking.
    expect(defaultTypeSize("mono", 0)).toBe(1);
    expect(defaultTypeSize("body", -100)).toBe(1);
    expect(defaultTypeSize("heading", 1)).toBe(1);
  });
});
