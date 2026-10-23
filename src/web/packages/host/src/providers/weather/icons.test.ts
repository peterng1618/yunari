import { describe, expect, it } from "vitest";
import { WMO_CONDITIONS } from "./conditions.js";
import {
  isVendoredWeatherIcon,
  VENDORED_ICON_SLUGS,
  weatherIconUrl,
} from "./icons.js";

describe("weatherIconUrl", () => {
  it("maps every canonical code to a day and a night icon from the allow-list", () => {
    for (const code of Object.keys(WMO_CONDITIONS).map(Number)) {
      for (const isDay of [true, false]) {
        const url = weatherIconUrl(code, isDay);
        expect(url, `${code} ${isDay ? "day" : "night"}`).toBeDefined();
        const slug = url
          ?.split("/")
          .pop()
          ?.replace(/\.svg$/, "");
        expect(VENDORED_ICON_SLUGS).toContain(slug);
        expect(isVendoredWeatherIcon(slug ?? "")).toBe(true);
      }
    }
  });

  it("uses the day or night variant the table names", () => {
    expect(weatherIconUrl(3, true)).toBe("/api/weather/icon/overcast-day.svg");
    expect(weatherIconUrl(3, false)).toBe(
      "/api/weather/icon/overcast-night.svg",
    );
    // A condition with one picture uses it for both halves of the day.
    expect(weatherIconUrl(61, false)).toBe("/api/weather/icon/rain.svg");
    expect(weatherIconUrl(48, true)).toBe("/api/weather/icon/fog.svg");
  });

  it("returns nothing for a code the table does not map", () => {
    expect(weatherIconUrl(42, true)).toBeUndefined();
  });
});

describe("isVendoredWeatherIcon", () => {
  it("accepts only an exact allow-listed slug", () => {
    expect(isVendoredWeatherIcon("clear-day")).toBe(true);
    expect(isVendoredWeatherIcon("clear-day.svg")).toBe(false);
    expect(isVendoredWeatherIcon("CLEAR-DAY")).toBe(false);
    expect(isVendoredWeatherIcon("../clear-day")).toBe(false);
    expect(isVendoredWeatherIcon("clear-day\0")).toBe(false);
    expect(isVendoredWeatherIcon("")).toBe(false);
  });
});
