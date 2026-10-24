import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where this PC's weather comes from, and the place it is for.
 *
 * The place is a person's own instruction, not a fact about the theme (the
 * manual path needs no permission and is the documented one), so it lives with
 * the machine's other settings. A stored file this build refuses is read as the
 * defaults with a reason for `/api/health`: a setting may be wrong, but it may
 * not stop the host or fail a display's poll.
 */

export type WeatherProviderId = "open-meteo" | "weatherapi" | "openweathermap";

const PROVIDERS: readonly WeatherProviderId[] = [
  "open-meteo",
  "weatherapi",
  "openweathermap",
];

export interface WeatherSettings {
  readonly provider: WeatherProviderId;
  /** The manual place's label. Empty means no manual place has been chosen. */
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Fall back to the Windows location when no manual place is set. */
  readonly useWindowsLocation: boolean;
  readonly pollIntervalMs: number;
}

/** No place, the keyless backend, and a ten-minute cadence. */
export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  provider: "open-meteo",
  label: "",
  latitude: 0,
  longitude: 0,
  useWindowsLocation: false,
  pollIntervalMs: 600_000,
};

const MIN_POLL_INTERVAL_MS = 60_000;
const MAX_POLL_INTERVAL_MS = 86_400_000;

export interface WeatherSettingsStore {
  read(): Promise<WeatherSettings>;
  write(input: unknown): Promise<WeatherSettings>;
  /** Why the stored file was refused, or `undefined` when it read cleanly. */
  problem(): string | undefined;
}

const FILE = "weather.json";

function isProvider(value: unknown): value is WeatherProviderId {
  return (PROVIDERS as readonly unknown[]).includes(value);
}

/** A stored number in range, or the field's refusal. The message names the
 *  field, because it is the writer that has to repair it. */
function readNumber(
  record: Record<string, unknown>,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = record[field];

  if (value === undefined) return fallback;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `The weather ${field} must be a number between ${min} and ${max}.`,
    );
  }

  if (value < min || value > max) {
    throw new Error(`The weather ${field} must be between ${min} and ${max}.`);
  }

  return value;
}

export function normalizeWeatherSettings(input: unknown): WeatherSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Weather settings must be an object.");
  }

  const record = input as Record<string, unknown>;

  // Only an absent field takes the default: `null` is a value the writer sent,
  // and reading it as "open-meteo" would store a choice nobody made.
  const offered = record["provider"];
  const provider =
    offered === undefined ? DEFAULT_WEATHER_SETTINGS.provider : offered;

  if (!isProvider(provider)) {
    throw new Error(
      `"${String(provider)}" is not a weather provider this host knows.`,
    );
  }

  const offeredLabel = record["label"];
  const label = offeredLabel === undefined ? "" : offeredLabel;

  if (typeof label !== "string") {
    throw new Error("The weather label must be text.");
  }

  // An absent label is no manual place; a present empty one is a place with
  // nothing to call it, and a reading would then have no location to name.
  if (offeredLabel !== undefined && label.trim() === "") {
    throw new Error("The weather label is required.");
  }

  const useWindowsLocation = record["useWindowsLocation"];

  if (
    useWindowsLocation !== undefined &&
    typeof useWindowsLocation !== "boolean"
  ) {
    throw new Error(
      "The weather useWindowsLocation setting must be true or false.",
    );
  }

  const pollIntervalMs = readNumber(
    record,
    "pollIntervalMs",
    DEFAULT_WEATHER_SETTINGS.pollIntervalMs,
    MIN_POLL_INTERVAL_MS,
    MAX_POLL_INTERVAL_MS,
  );

  if (!Number.isInteger(pollIntervalMs)) {
    throw new Error(
      "The weather pollIntervalMs must be a whole number of milliseconds.",
    );
  }

  return {
    provider,
    label: label.trim(),
    latitude: readNumber(record, "latitude", 0, -90, 90),
    longitude: readNumber(record, "longitude", 0, -180, 180),
    useWindowsLocation: useWindowsLocation ?? false,
    pollIntervalMs,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWeatherSettingsStore(
  directory: string,
): WeatherSettingsStore {
  const file = path.join(directory, FILE);

  /** Set by a read that refused the stored file, cleared by a clean read or a
   *  write: `/api/health` asks the store rather than parsing the file itself. */
  let problem: string | undefined;

  return {
    problem: () => problem,

    async read(): Promise<WeatherSettings> {
      let stored: string;

      try {
        stored = await readFile(file, "utf8");
      } catch (error: unknown) {
        // No file is no choice yet, which is the defaults and not a problem.
        problem =
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? undefined
            : reasonOf(error);
        return DEFAULT_WEATHER_SETTINGS;
      }

      try {
        const settings = normalizeWeatherSettings(JSON.parse(stored));
        problem = undefined;
        return settings;
      } catch (error: unknown) {
        // Unparsable, or a field this build refuses: the defaults can still be
        // polled, and the reason is what a person reads in `/api/health`.
        problem = reasonOf(error);
        return DEFAULT_WEATHER_SETTINGS;
      }
    },

    async write(input: unknown): Promise<WeatherSettings> {
      // Refused before the directory is touched, so a refusal never changes
      // the file a previous save left.
      const normalized = normalizeWeatherSettings(input);
      await mkdir(directory, { recursive: true });
      // Written beside the target and renamed over it, so a crash mid-write
      // leaves the previous file rather than a truncated one.
      const temporary = path.join(
        directory,
        `${FILE}.${randomBytes(6).toString("hex")}.tmp`,
      );
      // An unset place is stored as an absent field, not as `label: ""`: the
      // normalizer refuses an empty label, and a file this write produced must
      // never be one the next read refuses.
      const { label, ...unplaced } = normalized;
      await writeFile(
        temporary,
        `${JSON.stringify(label === "" ? unplaced : normalized, null, 2)}\n`,
        "utf8",
      );
      await rename(temporary, file);
      problem = undefined;
      return normalized;
    },
  };
}

/** One place the geocoder found: what to call it and where it is. */
export interface WeatherPlace {
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
}

/** Open-Meteo's geocoder, which needs no key: geocoding is not weather data,
 *  and a search is a person's own act rather than a poll. */
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const GEOCODING_TIMEOUT_MS = 5_000;
const GEOCODING_MAX_BYTES = 64 * 1024;

function placeOf(entry: unknown): WeatherPlace | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;

  const record = entry as Record<string, unknown>;
  const latitude = record["latitude"];
  const longitude = record["longitude"];

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return undefined;
  }

  // The label is the parts that exist, joined: an empty `admin1` for a city
  // that is its own region would otherwise read as a gap in the name.
  const label = [record["name"], record["admin1"], record["country_code"]]
    .flatMap((part) =>
      typeof part === "string" && part.trim() !== "" ? [part.trim()] : [],
    )
    .join(", ");

  if (label === "") return undefined;

  return { label, latitude, longitude };
}

/** The body, or a refusal once it passes the cap. Read in chunks so an
 *  upstream that ignores `content-length` cannot buffer a whole reply. */
async function readGeocodingBody(response: Response): Promise<string> {
  if (response.body === null) {
    throw new Error("The place search answered nothing.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;

      if (total > GEOCODING_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The place search answered more than it should.");
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

export async function searchWeatherPlaces(
  fetcher: typeof fetch,
  query: string,
): Promise<readonly WeatherPlace[]> {
  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  let response: Response;
  // A controller rather than `AbortSignal.timeout`, so the deadline is a JS
  // timer a test can advance; the signal still covers the body read below.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), GEOCODING_TIMEOUT_MS);

  try {
    try {
      response = await fetcher(url, {
        signal: controller.signal,
        // A redirect is not the geocoder this host asked: following one would
        // let another host answer a request this PC made to Open-Meteo.
        redirect: "error",
      });
    } catch {
      throw new Error("The place search could not reach Open-Meteo.");
    }

    if (!response.ok) {
      throw new Error(
        `The place search was refused (HTTP ${response.status}).`,
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(await readGeocodingBody(response));
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        throw new Error("The place search answered something unexpected.");
      }
      throw error;
    }

    const results = (parsed as { readonly results?: unknown } | null)?.results;

    if (!Array.isArray(results)) return [];

    // Five is the endpoint's own suggestion and the form's whole list; the
    // body cap alone would still admit a reply that ignored `count`.
    return results
      .flatMap((entry) => {
        const place = placeOf(entry);
        return place === undefined ? [] : [place];
      })
      .slice(0, 5);
  } finally {
    clearTimeout(deadline);
  }
}
