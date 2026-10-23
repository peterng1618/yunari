import { describe, expect, it } from "vitest";
import { conditionText, WMO_CONDITIONS, windCompass } from "./conditions.js";

describe("conditionText", () => {
  it("names a canonical code in English", () => {
    expect(conditionText(0, "en")).toBe("Clear sky");
    expect(WMO_CONDITIONS[0]).toBe("Clear sky");
  });

  it("falls back to English for an absent or unknown language", () => {
    expect(conditionText(3, undefined)).toBe("Overcast");
    expect(conditionText(3, "fr")).toBe("Overcast");
    expect(conditionText(3, "")).toBe("Overcast");
  });

  it("says unknown rather than showing the number", () => {
    expect(conditionText(42, "en")).toBe("Unknown");
    expect(conditionText(42, "fr")).toBe("Unknown");
  });

  it("covers the whole canonical WMO vocabulary", () => {
    expect(Object.keys(WMO_CONDITIONS)).toHaveLength(28);
  });
});

describe("windCompass", () => {
  it("names the cardinal points", () => {
    expect(windCompass(0)).toBe("N");
    expect(windCompass(90)).toBe("E");
    expect(windCompass(180)).toBe("S");
    expect(windCompass(270)).toBe("W");
  });

  it("rounds to the nearest of sixteen points and wraps at north", () => {
    expect(windCompass(348.75)).toBe("N");
    expect(windCompass(348.74)).toBe("NNW");
    expect(windCompass(360)).toBe("N");
    expect(windCompass(361)).toBe("N");
    expect(windCompass(161)).toBe("SSE");
  });

  it("wraps a negative bearing and one past a full turn", () => {
    expect(windCompass(-90)).toBe("W");
    expect(windCompass(-450)).toBe("W");
    expect(windCompass(450)).toBe("E");
    expect(windCompass(720)).toBe("N");
  });
});
