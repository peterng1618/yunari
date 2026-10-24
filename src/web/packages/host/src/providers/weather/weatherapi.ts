/**
 * WeatherAPI's `forecast.json`, normalized to one reading.
 *
 * The key rides in the query string by this API's design, so it is read only
 * here and never named in a reason. Its condition codes are not WMO: every code
 * the table below does not carry fails the acquisition rather than borrowing a
 * neighbouring condition.
 */

import {
  fetchWeatherJson,
  type WeatherLocation,
  type WeatherReading,
  weatherList,
  weatherNumber,
  weatherObject,
} from "./open-meteo.js";

export const WEATHERAPI_ENDPOINT =
  "https://api.weatherapi.com/v1/forecast.json";

/** Verified 2026-10-24 from <https://www.weatherapi.com/docs/attribution/>:
 *  the page's text option is "Powered by WeatherAPI.com". */
export const WEATHERAPI_ATTRIBUTION = "Powered by WeatherAPI.com";

const LABEL = "WeatherAPI";

/** Ruling 5's table: WeatherAPI's condition code to the canonical WMO code. */
const CONDITION_BY_CODE: Readonly<Record<number, number>> = {
  1000: 0,
  1003: 1,
  1006: 2,
  1009: 3,
  1030: 45,
  1135: 45,
  1147: 48,
  1087: 95,
  1114: 75,
  1117: 75,
  1150: 51,
  1153: 51,
  1168: 56,
  1171: 57,
  1180: 61,
  1183: 61,
  1186: 63,
  1189: 63,
  1192: 65,
  1195: 65,
  1198: 66,
  1201: 67,
  1204: 66,
  1207: 67,
  1210: 71,
  1213: 71,
  1216: 73,
  1219: 73,
  1222: 75,
  1225: 75,
  1237: 77,
  1240: 80,
  1243: 81,
  1246: 82,
  1249: 66,
  1252: 67,
  1255: 85,
  1258: 86,
  1264: 86,
  1261: 85,
  1273: 95,
  1276: 96,
  1279: 95,
  1282: 99,
};

function keyOf(key: string | undefined): string {
  if (key === undefined || key === "") {
    throw new Error("Set weatherapi in Settings.");
  }

  return key;
}

function textOf(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value === "") {
    throw new Error(`${LABEL}'s answer is missing ${field}.`);
  }

  return value;
}

function objectOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${LABEL}'s answer is missing ${what}.`);
  }

  return value as Record<string, unknown>;
}

function canonicalCode(code: number): number {
  const mapped = CONDITION_BY_CODE[code];

  if (mapped === undefined) {
    throw new Error(
      `WeatherAPI's condition code ${code} has no canonical condition.`,
    );
  }

  return mapped;
}

/**
 * A 12-hour wall clock plus the location's local date is one instant.
 *
 * `localtime_epoch` is the local wall clock read as an epoch, so its distance
 * from the real clock is the location's UTC offset (ruling 4). The same
 * one-offset-per-day ceiling Open-Meteo documents applies.
 */
function sunInstant(
  wall: unknown,
  localDate: string,
  offsetMs: number,
): string {
  if (typeof wall !== "string") {
    throw new Error(`${LABEL}'s answer is missing a sun time.`);
  }

  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(wall);

  if (match === null) {
    throw new Error(`${LABEL}'s answer has an unreadable sun time.`);
  }

  const hour =
    (Number(match[1]) % 12) + (match[3]?.toUpperCase() === "PM" ? 12 : 0);
  const utcMs = Date.parse(
    `${localDate}T${String(hour).padStart(2, "0")}:${match[2]}:00Z`,
  );

  if (!Number.isFinite(utcMs)) {
    throw new Error(`${LABEL}'s answer has an unreadable sun time.`);
  }

  return new Date(utcMs - offsetMs).toISOString();
}

export async function fetchWeatherApi(
  location: WeatherLocation,
  fetcher: typeof fetch,
  key: string | undefined,
): Promise<WeatherReading> {
  const url = new URL(WEATHERAPI_ENDPOINT);
  url.searchParams.set("key", keyOf(key));
  url.searchParams.set("q", `${location.latitude},${location.longitude}`);
  url.searchParams.set("days", "1");
  url.searchParams.set("aqi", "no");
  url.searchParams.set("alerts", "no");
  url.searchParams.set("lang", "en");

  const record = await fetchWeatherJson(fetcher, url, LABEL);
  const place = weatherObject(record, "location", LABEL);
  const current = weatherObject(record, "current", LABEL);
  const forecast = weatherObject(record, "forecast", LABEL);
  const days = weatherList(forecast, "forecastday", LABEL);
  const today = objectOf(days[0], "forecastday");
  const day = weatherObject(today, "day", LABEL);
  const astro = weatherObject(today, "astro", LABEL);
  const condition = weatherObject(current, "condition", LABEL);

  const localtime = textOf(place, "localtime");
  const localDate = localtime.slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error(`${LABEL}'s answer has an unreadable local time.`);
  }

  const offsetMs =
    weatherNumber(place, "localtime_epoch", LABEL) * 1000 - Date.now();
  const daylight = weatherNumber(current, "is_day", LABEL);

  if (daylight !== 0 && daylight !== 1) {
    throw new Error(`${LABEL}'s answer has an unreadable is_day.`);
  }

  return {
    tempC: weatherNumber(current, "temp_c", LABEL),
    feelsLikeC: weatherNumber(current, "feelslike_c", LABEL),
    highC: weatherNumber(day, "maxtemp_c", LABEL),
    lowC: weatherNumber(day, "mintemp_c", LABEL),
    humidity: weatherNumber(current, "humidity", LABEL),
    pressureHpa: weatherNumber(current, "pressure_mb", LABEL),
    precipitationMm: weatherNumber(current, "precip_mm", LABEL),
    windKph: weatherNumber(current, "wind_kph", LABEL),
    windDeg: weatherNumber(current, "wind_degree", LABEL),
    code: canonicalCode(weatherNumber(condition, "code", LABEL)),
    isDay: daylight === 1,
    sunriseIso: sunInstant(astro["sunrise"], localDate, offsetMs),
    sunsetIso: sunInstant(astro["sunset"], localDate, offsetMs),
  };
}

/** The Connections tab's check: one forecast request for London. */
export async function verifyWeatherApi(
  value: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = new URL(WEATHERAPI_ENDPOINT);
  url.searchParams.set("key", value);
  url.searchParams.set("q", "London");
  url.searchParams.set("days", "1");

  try {
    const response = await fetchImpl(url, { redirect: "error" });

    return response.ok
      ? { ok: true }
      : { ok: false, message: `WeatherAPI answered ${response.status}.` };
  } catch {
    // A transport error can quote the request URL, and that URL carries the
    // key: the check reports reachability without repeating either.
    return { ok: false, message: "WeatherAPI could not be reached." };
  }
}
