/**
 * OpenWeatherMap's current and five-day forecast endpoints, normalized to one
 * reading.
 *
 * The key rides in the query string by this API's design, so it is read only
 * here and never named in a reason. Two requests are needed because the current
 * answer has no daily high or low; both go through the shared bounded fetch.
 */

import {
  fetchWeatherJson,
  type WeatherLocation,
  type WeatherReading,
  weatherKey,
  weatherList,
  weatherNumber,
  weatherObject,
  weatherRecord,
} from "./open-meteo.js";

export const OPENWEATHERMAP_CURRENT_ENDPOINT =
  "https://api.openweathermap.org/data/2.5/weather";
export const OPENWEATHERMAP_FORECAST_ENDPOINT =
  "https://api.openweathermap.org/data/2.5/forecast";

/** Verified 2026-10-24 from <https://openweathermap.org/faq>: the required
 *  wording is "Weather data provided by OpenWeather". */
export const OPENWEATHERMAP_ATTRIBUTION =
  "Weather data provided by OpenWeather";

const LABEL = "OpenWeatherMap";

/** Ruling 7's table: OpenWeatherMap's condition id to the canonical WMO code. */
const CONDITION_BY_ID: Readonly<Record<number, number>> = {
  800: 0,
  801: 1,
  802: 2,
  803: 3,
  804: 3,
  200: 95,
  201: 95,
  202: 95,
  210: 95,
  211: 95,
  212: 95,
  221: 95,
  230: 95,
  231: 95,
  232: 96,
  300: 51,
  301: 51,
  302: 53,
  310: 53,
  311: 53,
  312: 55,
  313: 55,
  314: 55,
  321: 55,
  500: 61,
  501: 63,
  502: 65,
  503: 65,
  504: 65,
  511: 66,
  520: 80,
  521: 81,
  522: 82,
  531: 81,
  600: 71,
  601: 73,
  602: 75,
  611: 66,
  612: 66,
  613: 67,
  615: 66,
  616: 67,
  620: 85,
  621: 86,
  622: 86,
  701: 45,
  711: 45,
  721: 45,
  731: 45,
  741: 45,
  751: 45,
  761: 45,
  762: 45,
};

function canonicalCode(id: number): number {
  const mapped = CONDITION_BY_ID[id];

  if (mapped === undefined) {
    throw new Error(
      `OpenWeatherMap's condition id ${id} has no canonical condition.`,
    );
  }

  return mapped;
}

/**
 * The local calendar date a forecast entry belongs to. `city.timezone` is a
 * seconds offset from UTC, and the day boundaries a person sees are local ones:
 * bucketing in UTC would put a 23:00 entry on the wrong day.
 */
function localDate(dtSeconds: number, offsetSeconds: number): string {
  return new Date((dtSeconds + offsetSeconds) * 1000)
    .toISOString()
    .slice(0, 10);
}

function precipitationOf(current: Record<string, unknown>): number {
  const rain = current["rain"];

  // An absent `rain` key is this API's way of saying it reported no rain, and
  // 0 mm is that statement rather than a reading invented in its place.
  if (rain === undefined) return 0;

  const record = weatherRecord(rain, "rain", LABEL);

  return record["1h"] === undefined ? 0 : weatherNumber(record, "1h", LABEL);
}

interface DayRange {
  readonly high: number;
  readonly low: number;
}

/** Today's high and low from the three-hourly list, by the city's own date. */
function todayRange(
  forecast: Record<string, unknown>,
  nowMs: number,
  current: Record<string, unknown>,
): DayRange {
  const city = weatherObject(forecast, "city", LABEL);
  const offset = weatherNumber(city, "timezone", LABEL);
  const today = localDate(nowMs / 1000, offset);
  const rows = weatherList(forecast, "list", LABEL).flatMap((entry) => {
    const row = weatherRecord(entry, "list", LABEL);
    const dt = weatherNumber(row, "dt", LABEL);

    if (localDate(dt, offset) !== today) return [];

    const main = weatherObject(row, "main", LABEL);

    return [
      {
        high: weatherNumber(main, "temp_max", LABEL),
        low: weatherNumber(main, "temp_min", LABEL),
      },
    ];
  });

  if (rows.length === 0) {
    // `ponytail:` just before local midnight the three-hourly list can hold no
    // row for today, and failing the whole acquisition daily is worse than the
    // current answer's own range. The upgrade is a forecast list that names
    // today explicitly.
    return {
      high: weatherNumber(current, "temp_max", LABEL),
      low: weatherNumber(current, "temp_min", LABEL),
    };
  }

  return {
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
  };
}

export async function fetchOpenWeatherMap(
  location: WeatherLocation,
  fetcher: typeof fetch,
  key: string | undefined,
): Promise<WeatherReading> {
  const credential = weatherKey(key, "openweathermap");

  const currentUrl = new URL(OPENWEATHERMAP_CURRENT_ENDPOINT);
  const forecastUrl = new URL(OPENWEATHERMAP_FORECAST_ENDPOINT);

  for (const url of [currentUrl, forecastUrl]) {
    url.searchParams.set("lat", String(location.latitude));
    url.searchParams.set("lon", String(location.longitude));
    url.searchParams.set("units", "metric");
    url.searchParams.set("appid", credential);
  }

  const current = await fetchWeatherJson(fetcher, currentUrl, LABEL);
  const forecast = await fetchWeatherJson(fetcher, forecastUrl, LABEL);

  const condition = weatherRecord(
    weatherList(current, "weather", LABEL)[0],
    "weather",
    LABEL,
  );
  const main = weatherObject(current, "main", LABEL);
  const wind = weatherObject(current, "wind", LABEL);
  const sys = weatherObject(current, "sys", LABEL);
  const sunrise = weatherNumber(sys, "sunrise", LABEL);
  const sunset = weatherNumber(sys, "sunset", LABEL);
  const nowMs = Date.now();
  const range = todayRange(forecast, nowMs, main);

  return {
    tempC: weatherNumber(main, "temp", LABEL),
    feelsLikeC: weatherNumber(main, "feels_like", LABEL),
    highC: range.high,
    lowC: range.low,
    humidity: weatherNumber(main, "humidity", LABEL),
    pressureHpa: weatherNumber(main, "pressure", LABEL),
    precipitationMm: precipitationOf(current),
    // The metric request reports wind in metres per second; the vocabulary's
    // unit is km/h.
    windKph: weatherNumber(wind, "speed", LABEL) * 3.6,
    windDeg: weatherNumber(wind, "deg", LABEL),
    code: canonicalCode(weatherNumber(condition, "id", LABEL)),
    isDay: nowMs >= sunrise * 1000 && nowMs < sunset * 1000,
    sunriseIso: new Date(sunrise * 1000).toISOString(),
    sunsetIso: new Date(sunset * 1000).toISOString(),
  };
}

/** The Connections tab's check: one current-conditions request for London. */
export async function verifyOpenWeatherMap(
  value: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = new URL(OPENWEATHERMAP_CURRENT_ENDPOINT);
  url.searchParams.set("q", "London");
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", value);

  try {
    await fetchWeatherJson(fetchImpl, url, LABEL);
    return { ok: true };
  } catch (error: unknown) {
    // The shared request's reasons name the service, never the URL or the key
    // in it, so a transport failure can be repeated here.
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "OpenWeatherMap could not be checked.",
    };
  }
}
