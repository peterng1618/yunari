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
    expect(conditionText(42, "de")).toBe("Unknown");
  });

  it("covers the whole canonical WMO vocabulary", () => {
    expect(Object.keys(WMO_CONDITIONS)).toHaveLength(28);
  });

  it("names every canonical code in German", () => {
    const german: Record<number, string> = {
      0: "Klarer Himmel",
      1: "Überwiegend klar",
      2: "Teilweise bewölkt",
      3: "Bedeckt",
      45: "Nebel",
      48: "Reifnebel",
      51: "Leichter Nieselregen",
      53: "Mäßiger Nieselregen",
      55: "Dichter Nieselregen",
      56: "Leichter gefrierender Nieselregen",
      57: "Dichter gefrierender Nieselregen",
      61: "Leichter Regen",
      63: "Mäßiger Regen",
      65: "Starker Regen",
      66: "Leichter gefrierender Regen",
      67: "Starker gefrierender Regen",
      71: "Leichter Schneefall",
      73: "Mäßiger Schneefall",
      75: "Starker Schneefall",
      77: "Schneegriesel",
      80: "Leichte Regenschauer",
      81: "Mäßige Regenschauer",
      82: "Heftige Regenschauer",
      85: "Leichte Schneeschauer",
      86: "Starke Schneeschauer",
      95: "Gewitter",
      96: "Gewitter mit leichtem Hagel",
      99: "Gewitter mit starkem Hagel",
    };

    expect(Object.keys(german)).toHaveLength(28);
    for (const [code, text] of Object.entries(german)) {
      expect(conditionText(Number(code), "de"), `code ${code}`).toBe(text);
    }
  });

  it("resolves a region-tagged language by its primary subtag", () => {
    expect(conditionText(3, "de-DE")).toBe("Bedeckt");
    expect(conditionText(3, "de-AT")).toBe("Bedeckt");
    expect(conditionText(3, "DE")).toBe("Bedeckt");
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
