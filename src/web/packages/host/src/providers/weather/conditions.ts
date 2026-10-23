/**
 * The canonical condition vocabulary every weather backend maps into.
 *
 * WMO 4677 present-weather codes, the set Open-Meteo already reports. Text is
 * English here; a language the table does not carry falls back to it, and an
 * unknown code says "Unknown" rather than putting a number where prose belongs.
 */

export const WMO_CONDITIONS: Readonly<Record<number, string>> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

/** A closed vocabulary, not a translation platform: 3.3 adds the consumer's
 *  language here, and anything absent reads in English. */
const CONDITION_TEXT: Readonly<
  Record<string, Readonly<Record<number, string>>>
> = {
  en: WMO_CONDITIONS,
};

const UNKNOWN = "Unknown";

export function conditionText(
  code: number,
  language: string | undefined,
): string {
  const table = CONDITION_TEXT[language ?? "en"] ?? WMO_CONDITIONS;
  return table[code] ?? UNKNOWN;
}

/** Sixteen points, beginning at north. */
const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

/** The nearest compass point a bearing names; 348.75° rounds to north. */
export function windCompass(degrees: number): string {
  const index = Math.round(degrees / 22.5) % COMPASS.length;
  return COMPASS[(index + COMPASS.length) % COMPASS.length] ?? "N";
}
