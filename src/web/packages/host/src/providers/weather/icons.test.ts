import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WMO_CONDITIONS } from "./conditions.js";
import {
  isVendoredWeatherIcon,
  VENDORED_ICON_SLUGS,
  weatherIconUrl,
} from "./icons.js";

/** The exact pair every canonical code must name, written out rather than read
 *  from the table: swapping a day and a night slug must fail here. */
const EXPECTED: Readonly<
  Record<number, { readonly day: string; readonly night: string }>
> = {
  0: { day: "clear-day", night: "clear-night" },
  1: { day: "mostly-clear-day", night: "mostly-clear-night" },
  2: { day: "partly-cloudy-day", night: "partly-cloudy-night" },
  3: { day: "overcast-day", night: "overcast-night" },
  45: { day: "fog-day", night: "fog-night" },
  48: { day: "fog", night: "fog" },
  51: { day: "drizzle", night: "drizzle" },
  53: { day: "drizzle", night: "drizzle" },
  55: { day: "drizzle", night: "drizzle" },
  56: { day: "sleet", night: "sleet" },
  57: { day: "sleet", night: "sleet" },
  61: { day: "rain", night: "rain" },
  63: { day: "rain", night: "rain" },
  65: { day: "rain", night: "rain" },
  66: { day: "sleet", night: "sleet" },
  67: { day: "sleet", night: "sleet" },
  71: { day: "snow", night: "snow" },
  73: { day: "snow", night: "snow" },
  75: { day: "snow", night: "snow" },
  77: { day: "snow", night: "snow" },
  80: {
    day: "partly-cloudy-day-rain",
    night: "partly-cloudy-night-rain",
  },
  81: { day: "rain", night: "rain" },
  82: { day: "rain", night: "rain" },
  85: {
    day: "partly-cloudy-day-snow",
    night: "partly-cloudy-night-snow",
  },
  86: { day: "snow", night: "snow" },
  95: { day: "thunderstorms-day", night: "thunderstorms-night" },
  96: {
    day: "thunderstorms-day-rain",
    night: "thunderstorms-night-rain",
  },
  99: {
    day: "thunderstorms-day-rain",
    night: "thunderstorms-night-rain",
  },
};

/** The committed bytes the route reads, resolved from this test's own file. */
const VENDOR_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "vendor",
  "weather-icons",
);

describe("weatherIconUrl", () => {
  it("maps every canonical code to its exact day and night picture", () => {
    expect(
      Object.keys(EXPECTED)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(
      Object.keys(WMO_CONDITIONS)
        .map(Number)
        .sort((a, b) => a - b),
    );

    for (const [code, pair] of Object.entries(EXPECTED)) {
      expect(weatherIconUrl(Number(code), true), `${code} day`).toBe(
        `/api/weather/icon/${pair.day}.svg`,
      );
      expect(weatherIconUrl(Number(code), false), `${code} night`).toBe(
        `/api/weather/icon/${pair.night}.svg`,
      );
    }
  });

  it("returns nothing for a code the table does not map", () => {
    expect(weatherIconUrl(42, true)).toBeUndefined();
  });
});

describe("the vendored set", () => {
  it("ships exactly the allow-list, so no generated URL can 404", () => {
    const committed = readdirSync(VENDOR_DIR)
      .filter((file) => file.endsWith(".svg"))
      .map((file) => file.slice(0, -".svg".length))
      .sort();

    expect(committed).toEqual([...VENDORED_ICON_SLUGS].sort());
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
