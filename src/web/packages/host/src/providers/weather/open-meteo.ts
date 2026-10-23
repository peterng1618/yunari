/**
 * Open-Meteo's current-conditions endpoint, normalized to one reading.
 *
 * The request asks for metric explicitly by taking the endpoint's defaults, and
 * names only the fields the weather keys need. The answer is bounded in size
 * and time, and a reason never carries the URL: the reason reaches every display
 * on the network.
 */

export interface WeatherLocation {
  readonly latitude: number;
  readonly longitude: number;
}

/** One acquisition's worth of weather, in the vocabulary's own units. */
export interface WeatherReading {
  readonly tempC: number;
  readonly feelsLikeC: number;
  readonly highC: number;
  readonly lowC: number;
  readonly humidity: number;
  readonly pressureHpa: number;
  readonly precipitationMm: number;
  readonly windKph: number;
  readonly windDeg: number;
  readonly code: number;
  readonly isDay: boolean;
  readonly sunriseIso: string;
  readonly sunsetIso: string;
}

export const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Verified 2026-10-24 from <https://open-meteo.com/en/licence> (CC BY 4.0):
 *  the page's own example credit is this string, linking to open-meteo.com. */
export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com";

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024;

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Open-Meteo's answer is missing ${field}.`);
  }

  return value;
}

function numberOf(record: Record<string, unknown>, field: string): number {
  return finiteNumber(record[field], field);
}

function firstOf(record: Record<string, unknown>, field: string): unknown {
  const list = record[field];

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`Open-Meteo's answer is missing ${field}.`);
  }

  return list[0];
}

/**
 * A local wall time (`2026-10-24T07:47`) plus the response's own UTC offset is
 * one instant.
 *
 * `ponytail:` a single offset is applied to both sun times. On a DST-change day
 * one of them can be an hour off; the upgrade is to read a per-day offset from
 * the API if it ever offers one.
 */
function toInstant(wall: unknown, offsetSeconds: number): string {
  if (typeof wall !== "string") {
    throw new Error("Open-Meteo's answer is missing a sun time.");
  }

  const withSeconds = /T\d{2}:\d{2}$/.test(wall) ? `${wall}:00` : wall;
  const utcMs = Date.parse(`${withSeconds}Z`);

  if (!Number.isFinite(utcMs)) {
    throw new Error("Open-Meteo's answer has an unreadable sun time.");
  }

  return new Date(utcMs - offsetSeconds * 1000).toISOString();
}

/** The body, or a refusal once it passes the cap. Chunked so an upstream that
 *  ignores `content-length` cannot buffer a whole reply. */
async function readBody(response: Response): Promise<string> {
  if (response.body === null) {
    throw new Error("Open-Meteo answered nothing.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;

      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Open-Meteo answered more than it should.");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8",
  );
}

export async function fetchOpenMeteo(
  fetcher: typeof fetch,
  location: WeatherLocation,
): Promise<WeatherReading> {
  const url = new URL(OPEN_METEO_ENDPOINT);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set(
    "current",
    // `pressure_msl` is not in the recorded probe, but `weather.pressure` has no
    // other source; see the task report's note on ruling 3.
    "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day,pressure_msl",
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,sunrise,sunset",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  let response: Response;
  // A controller rather than `AbortSignal.timeout`, so the deadline is a timer
  // the suite can advance without a real wait.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    try {
      response = await fetcher(url, {
        signal: controller.signal,
        // A redirect is not the endpoint this host asked.
        redirect: "error",
      });
    } catch {
      throw new Error("Open-Meteo could not be reached.");
    }

    if (!response.ok) {
      throw new Error(`Open-Meteo answered HTTP ${response.status}.`);
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(await readBody(response));
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        throw new Error("Open-Meteo answered something unexpected.");
      }
      throw error;
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Open-Meteo answered something unexpected.");
    }

    const record = parsed as Record<string, unknown>;
    const current = record["current"];
    const daily = record["daily"];

    if (
      typeof current !== "object" ||
      current === null ||
      typeof daily !== "object" ||
      daily === null
    ) {
      throw new Error("Open-Meteo answered something unexpected.");
    }

    const currentRecord = current as Record<string, unknown>;
    const dailyRecord = daily as Record<string, unknown>;
    const offset = numberOf(record, "utc_offset_seconds");
    const daylight = numberOf(currentRecord, "is_day");

    if (daylight !== 0 && daylight !== 1) {
      throw new Error("Open-Meteo's answer has an unreadable is_day.");
    }

    return {
      tempC: numberOf(currentRecord, "temperature_2m"),
      feelsLikeC: numberOf(currentRecord, "apparent_temperature"),
      highC: finiteNumber(
        firstOf(dailyRecord, "temperature_2m_max"),
        "temperature_2m_max",
      ),
      lowC: finiteNumber(
        firstOf(dailyRecord, "temperature_2m_min"),
        "temperature_2m_min",
      ),
      humidity: numberOf(currentRecord, "relative_humidity_2m"),
      pressureHpa: numberOf(currentRecord, "pressure_msl"),
      precipitationMm: numberOf(currentRecord, "precipitation"),
      windKph: numberOf(currentRecord, "wind_speed_10m"),
      windDeg: numberOf(currentRecord, "wind_direction_10m"),
      code: numberOf(currentRecord, "weather_code"),
      isDay: daylight === 1,
      sunriseIso: toInstant(firstOf(dailyRecord, "sunrise"), offset),
      sunsetIso: toInstant(firstOf(dailyRecord, "sunset"), offset),
    };
  } finally {
    clearTimeout(deadline);
  }
}
