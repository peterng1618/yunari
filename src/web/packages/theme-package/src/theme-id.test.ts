import { describe, expect, it } from "vitest";
import { themeIdFromName } from "./theme-id.js";

describe("themeIdFromName", () => {
  it("lowercases, collapses runs outside the id shape and trims", () => {
    expect(themeIdFromName("  Living Room!  ")).toBe("living-room");
    expect(themeIdFromName("A/B & C")).toBe("a-b-c");
    // A name with no id-shaped characters answers nothing; the caller picks the
    // fallback, because an import and a Save as need not choose the same one.
    expect(themeIdFromName("東京")).toBe("");
  });

  it("stops short of the id shape so a suffix still fits", () => {
    expect(themeIdFromName("x".repeat(80))).toHaveLength(56);
  });
});
