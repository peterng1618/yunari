import {
  describeSemanticKey,
  type Sample,
  type SampleEntry,
} from "@yunari/renderer-core";
import type { CredentialStore } from "../../settings/credentials.js";
import type {
  WeatherSettings,
  WeatherSettingsStore,
} from "../../settings/weather.js";
import type {
  ProviderHealth,
  SampleContext,
  SensorDescriptor,
  SensorProvider,
} from "../provider.js";
import { descriptorFieldsOf, redactForBrowser } from "../provider.js";
import { WEATHER_BACKENDS } from "./backends.js";
import { conditionText, windCompass } from "./conditions.js";
import { weatherIconUrl } from "./icons.js";
import type { WeatherReading } from "./open-meteo.js";

/**
 * Weather as readings, acquired by this provider rather than inside the host's
 * poll cycle.
 *
 * `sample()` is a cache read: a display asking for a weather key records demand
 * and gets whatever the last acquisition produced. One timer per provider
 * fetches on the consumer's cadence, backs off on failure, and stops once no
 * display has asked for longer than the window that makes a reading stale.
 * Decision 0099 records why weather owns its clock.
 */

const WEATHER_PROVIDER_ID = "weather";

export const WEATHER_KEYS = [
  "weather.location",
  "weather.temp",
  "weather.feelsLike",
  "weather.conditionCode",
  "weather.condition",
  "weather.icon",
  "weather.humidity",
  "weather.windSpeed",
  "weather.windDirection",
  "weather.windDirection.compass",
  "weather.pressure",
  "weather.precipitation",
  "weather.isDay",
  "weather.sunrise",
  "weather.sunset",
  "weather.high",
  "weather.low",
  "weather.attribution",
] as const;

export const WEATHER_DESCRIPTORS: readonly SensorDescriptor[] =
  WEATHER_KEYS.map((key) => {
    const declared = describeSemanticKey(key);

    if (declared === undefined) {
      throw new Error(`${key} is not in the semantic key vocabulary`);
    }

    return {
      sensorId: `${WEATHER_PROVIDER_ID}:${key}`,
      semanticKey: key,
      label: declared.label,
      ...descriptorFieldsOf(declared),
      tier: declared.expectedTier,
    };
  });

const UNIT_BY_KEY: ReadonlyMap<string, string | undefined> = new Map(
  WEATHER_DESCRIPTORS.map((descriptor) => [
    descriptor.semanticKey,
    descriptor.unit,
  ]),
);

/** What a display is told when no place has been chosen yet. */
export const NO_PLACE_MESSAGE =
  "Set a place in Settings, or turn on Windows location.";

const NO_ICON_MESSAGE = "No icon is available for this condition.";
const WAITING_MESSAGE = "Waiting for the first weather reading.";
const STALE_MESSAGE = "The last weather reading is out of date.";

const MIN_IDLE_WINDOW_MS = 30 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/** The window past which the last good reading is stale, and past which an
 *  undemanded provider stops polling: whichever of the two is longer. */
function idleWindowMs(intervalMs: number): number {
  return Math.max(3 * intervalMs, MIN_IDLE_WINDOW_MS);
}

export interface WeatherProviderOptions {
  readonly settings: WeatherSettingsStore;
  /** Where a BYOK backend's key is read inside the host. */
  readonly credentials?: CredentialStore;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}

interface CachedReading {
  readonly reading: WeatherReading;
  readonly fetchedAtMs: number;
}

export class WeatherProvider implements SensorProvider {
  readonly id = WEATHER_PROVIDER_ID;
  readonly label = "Weather";

  readonly #settingsStore: WeatherSettingsStore;
  readonly #credentials: CredentialStore | undefined;
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;

  /** Last settings read, refreshed on every sample and every tick. */
  #settings: WeatherSettings | undefined;
  #lastGood: CachedReading | undefined;
  /** Redacted; may reach a browser through `health()` and a sample message. */
  #failure: string | undefined;
  #failures = 0;
  /** Backend plus place; a change drops the reading and the backoff. */
  #lastIdentity: string | undefined;
  #generation = 0;
  #polling = false;
  #lastDemandMs = Number.NEGATIVE_INFINITY;
  #running = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: WeatherProviderOptions) {
    this.#settingsStore = options.settings;
    this.#credentials = options.credentials;
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => Date.now());
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    return WEATHER_DESCRIPTORS;
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
    context: SampleContext = {},
  ): Promise<readonly SampleEntry[]> {
    const wanted = WEATHER_KEYS.filter((key) => semanticKeys.includes(key));

    if (wanted.length === 0) {
      return [];
    }

    // Demand is what starts and keeps the clock; a sample that asks for no
    // weather key must not spend this PC's request.
    this.#lastDemandMs = nowMs;
    // Read every sample so a settings write is seen without waiting a whole
    // interval (a backoff can be an hour); the file is one small JSON object.
    const settings = await this.#refreshSettings();
    const moved = this.#remember(settings);

    if (!this.#running) {
      this.#running = true;
      void this.#poll();
    } else if (moved) {
      this.#pollNow();
    }

    // Only the cached reading's text is localized here: the clock above owns
    // acquisition, and the language must never reach it.
    return wanted.map((semanticKey) => ({
      semanticKey,
      sample: this.#sampleOf(semanticKey, settings, nowMs, context.language),
    }));
  }

  health(): ProviderHealth {
    return this.#failure === undefined
      ? { available: true }
      : { available: false, message: this.#failure };
  }

  async #refreshSettings(): Promise<WeatherSettings> {
    this.#settings = await this.#settingsStore.read();
    return this.#settings;
  }

  /**
   * Records the backend and place, and drops everything derived from a
   * different one. True when this call saw the change: the reading came from
   * another backend or place, and its age and backoff do not describe this one.
   */
  #remember(settings: WeatherSettings): boolean {
    const identity = [
      settings.provider,
      settings.label,
      settings.latitude,
      settings.longitude,
    ].join("\u0000");

    if (identity === this.#lastIdentity) return false;

    const first = this.#lastIdentity === undefined;
    this.#lastIdentity = identity;

    if (first) return false;

    this.#generation += 1;
    this.#lastGood = undefined;
    this.#failure = undefined;
    this.#failures = 0;
    return true;
  }

  /** Drops a scheduled wait, including a backoff, and acquires now. */
  #pollNow(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    // An in-flight poll checks the generation before storing its reading and
    // schedules the next one at zero, so this cannot double-fetch.
    if (!this.#polling) void this.#poll();
  }

  async #poll(): Promise<void> {
    if (!this.#running || this.#polling) return;
    this.#polling = true;

    let delayMs = MAX_BACKOFF_MS;

    try {
      const settings = await this.#refreshSettings();
      this.#remember(settings);
      const intervalMs = settings.pollIntervalMs;
      const generation = this.#generation;
      const now = this.#now();

      if (now - this.#lastDemandMs > idleWindowMs(intervalMs)) {
        this.#stop();
        return;
      }

      if (settings.label === "") {
        // No place, so there is nothing to ask for. The timer keeps ticking so
        // a place saved later is picked up without a restart.
        delayMs = intervalMs;
      } else {
        try {
          const reading = await WEATHER_BACKENDS[settings.provider].fetch(
            { latitude: settings.latitude, longitude: settings.longitude },
            this.#fetcher,
            settings.provider === "open-meteo"
              ? undefined
              : await this.#credentials?.valueOf(settings.provider),
          );

          if (generation !== this.#generation) {
            // The backend or place moved while this request was in flight; the
            // change already asked for a poll, and the old reading must not win.
            delayMs = 0;
          } else {
            this.#lastGood = { reading, fetchedAtMs: this.#now() };
            this.#failure = undefined;
            this.#failures = 0;
            delayMs = intervalMs;
          }
        } catch (error: unknown) {
          this.#failures += 1;
          this.#failure = redactForBrowser(
            error instanceof Error ? error.message : String(error),
          );
          delayMs = Math.min(intervalMs * 2 ** this.#failures, MAX_BACKOFF_MS);
        }
      }
    } catch (error: unknown) {
      // A settings read that fails must not kill the clock; the next tick tries
      // again and the display sees a redacted reason in the meantime.
      this.#failure = redactForBrowser(
        error instanceof Error ? error.message : String(error),
      );
      delayMs = MAX_BACKOFF_MS;
    } finally {
      this.#polling = false;
    }

    this.#schedule(delayMs);
  }

  #schedule(delayMs: number): void {
    if (!this.#running) return;

    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#poll();
    }, delayMs);
    // A host whose displays are idle still exits on its own.
    (this.#timer as { unref?: () => void }).unref?.();
  }

  #stop(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#running = false;
  }

  #sampleOf(
    semanticKey: string,
    settings: WeatherSettings,
    nowMs: number,
    language: string | undefined,
  ): Sample {
    const sensorId = `${WEATHER_PROVIDER_ID}:${semanticKey}`;
    const timestamp = new Date(nowMs).toISOString();

    if (settings.label === "") {
      return {
        sensorId,
        timestamp,
        status: "unavailable",
        message: NO_PLACE_MESSAGE,
      };
    }

    if (this.#lastGood === undefined) {
      return {
        sensorId,
        timestamp,
        status: this.#failure === undefined ? "missing" : "error",
        message: this.#failure ?? WAITING_MESSAGE,
      };
    }

    if (
      nowMs - this.#lastGood.fetchedAtMs >
      idleWindowMs(settings.pollIntervalMs)
    ) {
      return { sensorId, timestamp, status: "stale", message: STALE_MESSAGE };
    }

    return this.#readingSample(
      semanticKey,
      sensorId,
      timestamp,
      settings,
      language,
    );
  }

  #readingSample(
    semanticKey: string,
    sensorId: string,
    timestamp: string,
    settings: WeatherSettings,
    language: string | undefined,
  ): Sample {
    const reading = this.#lastGood?.reading;

    if (reading === undefined) {
      return {
        sensorId,
        timestamp,
        status: "missing",
        message: WAITING_MESSAGE,
      };
    }

    const unit = UNIT_BY_KEY.get(semanticKey);

    const numeric = (value: number): Sample => ({
      sensorId,
      timestamp,
      status: "ok",
      value,
      ...(unit === undefined ? {} : { unit }),
    });

    const text = (textValue: string): Sample => ({
      sensorId,
      timestamp,
      status: "ok",
      textValue,
    });

    switch (semanticKey) {
      case "weather.location":
        return text(settings.label);
      case "weather.temp":
        return numeric(reading.tempC);
      case "weather.feelsLike":
        return numeric(reading.feelsLikeC);
      case "weather.high":
        return numeric(reading.highC);
      case "weather.low":
        return numeric(reading.lowC);
      case "weather.conditionCode":
        return numeric(reading.code);
      case "weather.condition":
        return text(conditionText(reading.code, language));
      case "weather.icon": {
        const url = weatherIconUrl(reading.code, reading.isDay);
        return url === undefined
          ? {
              sensorId,
              timestamp,
              status: "unavailable",
              message: NO_ICON_MESSAGE,
            }
          : text(url);
      }
      case "weather.humidity":
        return numeric(reading.humidity);
      case "weather.pressure":
        return numeric(reading.pressureHpa);
      case "weather.precipitation":
        return numeric(reading.precipitationMm);
      case "weather.windSpeed":
        return numeric(reading.windKph);
      case "weather.windDirection":
        return numeric(reading.windDeg);
      case "weather.windDirection.compass":
        return text(windCompass(reading.windDeg));
      case "weather.isDay":
        return {
          sensorId,
          timestamp,
          status: "ok",
          booleanValue: reading.isDay,
        };
      case "weather.sunrise":
        return text(reading.sunriseIso);
      case "weather.sunset":
        return text(reading.sunsetIso);
      case "weather.attribution":
        return text(WEATHER_BACKENDS[settings.provider].attribution);
      default:
        return {
          sensorId,
          timestamp,
          status: "missing",
          message: "This host does not read that weather key.",
        };
    }
  }
}
