import type { SampleEntry } from "@yunari/renderer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeWeatherSettings,
  type WeatherSettings,
  type WeatherSettingsStore,
} from "../../settings/weather.js";
import { OPEN_METEO_BERLIN_CAPTURE } from "./open-meteo.fixture.js";
import { WEATHER_KEYS, WeatherProvider } from "./provider.js";

const BERLIN: WeatherSettings = normalizeWeatherSettings({
  provider: "open-meteo",
  label: "Berlin, Berlin, DE",
  latitude: 52.52,
  longitude: 13.41,
  useWindowsLocation: false,
  pollIntervalMs: 600_000,
});

function settingsStore(
  initial: WeatherSettings = BERLIN,
): WeatherSettingsStore & { set(next: WeatherSettings): void } {
  let current = initial;

  return {
    read: async () => current,
    write: async (input) => {
      current = normalizeWeatherSettings(input);
      return current;
    },
    problem: () => undefined,
    set: (next) => {
      current = next;
    },
  };
}

function fetcherOf(
  body: string | (() => Response) = JSON.stringify(OPEN_METEO_BERLIN_CAPTURE),
): { fetcher: typeof fetch; calls: () => number } {
  let calls = 0;

  return {
    calls: () => calls,
    fetcher: (async () => {
      calls += 1;
      return typeof body === "function"
        ? body()
        : new Response(body, { status: 200 });
    }) as unknown as typeof fetch,
  };
}

/** Lets the fetch `sample` kicked off settle without moving the clock. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function host(
  store: WeatherSettingsStore,
  fetcher: typeof fetch,
): WeatherProvider {
  return new WeatherProvider({ settings: store, fetcher });
}

function sampleAt(
  provider: WeatherProvider,
  keys: readonly string[],
  nowMs: number,
): Promise<readonly SampleEntry[]> {
  return provider.sample(keys, nowMs);
}

describe("WeatherProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("describes the eighteen weather keys from the vocabulary", async () => {
    const provider = host(settingsStore(), fetcherOf().fetcher);
    const descriptors = await provider.describe();

    expect(descriptors.map((entry) => entry.semanticKey)).toEqual([
      ...WEATHER_KEYS,
    ]);
    expect(descriptors.every((entry) => entry.tier === "baseline")).toBe(true);
    expect(
      descriptors.find((entry) => entry.semanticKey === "weather.icon")
        ?.mediaKind,
    ).toBe("image");
  });

  it("turns one cached reading into every weather sample", async () => {
    const now = Date.now();
    const { fetcher } = fetcherOf();
    const provider = host(settingsStore(), fetcher);

    await sampleAt(provider, ["weather.temp"], now);
    await settle();
    const entries = await sampleAt(provider, WEATHER_KEYS, now);
    const byKey = new Map(entries.map((e) => [e.semanticKey, e.sample]));

    expect(byKey.size).toBe(18);
    for (const sample of byKey.values()) {
      expect(sample.status, String(sample.sensorId)).toBe("ok");
    }

    expect(byKey.get("weather.temp")).toMatchObject({
      value: 11.3,
      unit: "°C",
    });
    expect(byKey.get("weather.feelsLike")).toMatchObject({
      value: 7.9,
      unit: "°C",
    });
    expect(byKey.get("weather.high")).toMatchObject({
      value: 11.6,
      unit: "°C",
    });
    expect(byKey.get("weather.low")).toMatchObject({ value: 6.7, unit: "°C" });
    expect(byKey.get("weather.humidity")).toMatchObject({
      value: 64,
      unit: "%",
    });
    expect(byKey.get("weather.pressure")).toMatchObject({
      value: 1006.7,
      unit: "hPa",
    });
    expect(byKey.get("weather.precipitation")).toMatchObject({
      value: 0,
      unit: "mm",
    });
    expect(byKey.get("weather.windSpeed")).toMatchObject({
      value: 14.5,
      unit: "km/h",
    });
    expect(byKey.get("weather.windDirection")).toMatchObject({
      value: 161,
      unit: "°",
    });
    expect(byKey.get("weather.windDirection.compass")).toMatchObject({
      textValue: "SSE",
    });
    expect(byKey.get("weather.conditionCode")).toMatchObject({ value: 3 });
    expect(byKey.get("weather.condition")).toMatchObject({
      textValue: "Overcast",
    });
    expect(byKey.get("weather.icon")).toMatchObject({
      textValue: "/api/weather/icon/overcast-night.svg",
    });
    expect(byKey.get("weather.isDay")).toMatchObject({ booleanValue: false });
    expect(byKey.get("weather.location")).toMatchObject({
      textValue: "Berlin, Berlin, DE",
    });
    expect(byKey.get("weather.sunrise")).toMatchObject({
      textValue: "2026-10-24T05:47:00.000Z",
    });
    expect(byKey.get("weather.sunset")).toMatchObject({
      textValue: "2026-10-24T15:52:00.000Z",
    });
    expect(byKey.get("weather.attribution")).toMatchObject({
      textValue: "Weather data by Open-Meteo.com",
    });
  });

  it("leaves an icon unavailable when the code has no vendored picture", async () => {
    const capture = structuredClone(OPEN_METEO_BERLIN_CAPTURE) as {
      current: { weather_code: number };
    };
    capture.current.weather_code = 42;
    const provider = host(
      settingsStore(),
      fetcherOf(JSON.stringify(capture)).fetcher,
    );

    await sampleAt(provider, ["weather.icon"], Date.now());
    await settle();
    const entries = await sampleAt(provider, WEATHER_KEYS, Date.now());
    const byKey = new Map(entries.map((e) => [e.semanticKey, e.sample]));

    expect(byKey.get("weather.icon")).toMatchObject({ status: "unavailable" });
    expect(byKey.get("weather.icon")?.textValue).toBeUndefined();
    expect(byKey.get("weather.condition")).toMatchObject({
      status: "ok",
      textValue: "Unknown",
    });
    expect(byKey.get("weather.temp")).toMatchObject({
      status: "ok",
      value: 11.3,
    });
  });

  it("localizes the condition text and leaves every number identical", async () => {
    const now = Date.now();
    const provider = host(settingsStore(), fetcherOf().fetcher);
    const keys = ["weather.temp", "weather.condition"];

    await sampleAt(provider, ["weather.temp"], now);
    await settle();

    const en = await provider.sample(keys, now, { language: "en" });
    const de = await provider.sample(keys, now, { language: "de" });
    const sampleOf = (
      entries: readonly SampleEntry[],
      key: string,
    ): SampleEntry["sample"] | undefined =>
      entries.find((entry) => entry.semanticKey === key)?.sample;

    expect(sampleOf(en, "weather.condition")).toMatchObject({
      textValue: "Overcast",
    });
    expect(sampleOf(de, "weather.condition")).toMatchObject({
      textValue: "Bedeckt",
    });
    // The reading is one measurement in two languages, not two readings.
    expect(sampleOf(de, "weather.temp")).toMatchObject({
      value: 11.3,
      unit: "°C",
    });
    expect(sampleOf(de, "weather.temp")).toEqual(sampleOf(en, "weather.temp"));
  });

  it("reports no place as unavailable and never fetches", async () => {
    const { fetcher, calls } = fetcherOf();
    const provider = host(
      settingsStore(
        normalizeWeatherSettings({
          ...BERLIN,
          label: undefined,
          latitude: 0,
          longitude: 0,
        }),
      ),
      fetcher,
    );

    const entries = await sampleAt(provider, WEATHER_KEYS, Date.now());
    await settle();
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(calls()).toBe(0);
    for (const entry of entries) {
      expect(entry.sample.status).toBe("unavailable");
      expect(entry.sample.message).toBe(
        "Set a place in Settings, or turn on Windows location.",
      );
      expect(entry.sample).not.toHaveProperty("value");
      expect(entry.sample).not.toHaveProperty("textValue");
      expect(entry.sample).not.toHaveProperty("booleanValue");
    }
  });

  it("reports a refused fetch as an error with a redacted reason", async () => {
    const provider = host(settingsStore(), (async () => {
      throw new Error(
        "fetch failed for https://api.open-meteo.com/v1/forecast?latitude=52.52",
      );
    }) as unknown as typeof fetch);

    await sampleAt(provider, ["weather.temp"], Date.now());
    await settle();
    const [entry] = await sampleAt(provider, ["weather.temp"], Date.now());

    expect(entry?.sample.status).toBe("error");
    expect(String(entry?.sample.message)).not.toMatch(/api\.open-meteo\.com/);
    expect(entry?.sample).not.toHaveProperty("value");
    expect(provider.health().available).toBe(false);
  });

  it("does not fetch until a weather key is demanded, then polls on the interval", async () => {
    const { fetcher, calls } = fetcherOf();
    const provider = host(settingsStore(), fetcher);
    const start = Date.now();

    await sampleAt(provider, ["cpu.load"], start);
    await vi.advanceTimersByTimeAsync(5 * 600_000);
    expect(calls()).toBe(0);

    await sampleAt(provider, ["weather.temp"], Date.now());
    await settle();
    expect(calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls()).toBe(2);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls()).toBe(3);
  });

  it("re-reads the interval each tick so a settings change lands without a restart", async () => {
    const store = settingsStore();
    const { fetcher, calls } = fetcherOf();
    const provider = host(store, fetcher);

    await sampleAt(provider, ["weather.temp"], Date.now());
    await settle();
    expect(calls()).toBe(1);

    store.set({ ...BERLIN, pollIntervalMs: 120_000 });

    // The timer already scheduled keeps its old delay; the tick it runs reads
    // the new interval and schedules the one after it at that cadence.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls()).toBe(3);
  });

  it("backs off exponentially on failure, capped at an hour", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response("no", { status: 503 });
    }) as unknown as typeof fetch;

    const provider = host(
      settingsStore({ ...BERLIN, pollIntervalMs: 60_000 }),
      fetcher,
    );

    await sampleAt(provider, ["weather.temp"], Date.now());
    await settle();
    expect(calls).toBe(1);

    /** Keeps a display demanding the key while the clock moves, as a real one
     *  does every poll cycle; otherwise the idle window stops the timer long
     *  before the backoff cap is reachable. */
    const demandAndAdvance = async (totalMs: number): Promise<void> => {
      let remaining = totalMs;

      while (remaining > 0) {
        const step = Math.min(remaining, 60_000);
        await sampleAt(provider, ["weather.temp"], Date.now());
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
    };

    // Failures one to five schedule 2, 4, 8, 16 and 32 minutes. The sixth
    // would schedule 64, and the cap makes it exactly 60.
    for (const delay of [120_000, 240_000, 480_000, 960_000, 1_920_000]) {
      await demandAndAdvance(delay);
    }
    expect(calls).toBe(6);

    await demandAndAdvance(3_599_000);
    expect(calls).toBe(6);
    await demandAndAdvance(1_000);
    expect(calls).toBe(7);
  });

  it("marks a last-good reading stale after three intervals or thirty minutes, whichever is longer", async () => {
    const now = Date.now();
    const { fetcher } = fetcherOf();
    const provider = host(
      settingsStore({ ...BERLIN, pollIntervalMs: 60_000 }),
      fetcher,
    );

    await sampleAt(provider, ["weather.temp"], now);
    await settle();

    const atBoundary = await sampleAt(
      provider,
      ["weather.temp"],
      now + 30 * 60_000,
    );
    expect(atBoundary[0]?.sample.status).toBe("ok");

    const past = await sampleAt(
      provider,
      ["weather.temp"],
      now + 30 * 60_000 + 1,
    );
    expect(past[0]?.sample.status).toBe("stale");
    expect(past[0]?.sample).not.toHaveProperty("value");
    expect(past[0]?.sample).not.toHaveProperty("textValue");
  });

  it("uses three intervals when that is longer than thirty minutes", async () => {
    const now = Date.now();
    const { fetcher } = fetcherOf();
    const provider = host(
      settingsStore({ ...BERLIN, pollIntervalMs: 3_600_000 }),
      fetcher,
    );

    await sampleAt(provider, ["weather.temp"], now);
    await settle();

    // A one-hour cadence makes the window three hours, not thirty minutes.
    const atBoundary = await sampleAt(
      provider,
      ["weather.temp"],
      now + 3 * 3_600_000,
    );
    expect(atBoundary[0]?.sample.status).toBe("ok");

    const past = await sampleAt(
      provider,
      ["weather.temp"],
      now + 3 * 3_600_000 + 1,
    );
    expect(past[0]?.sample.status).toBe("stale");
  });

  it("stops polling after the longer of three intervals and thirty minutes without demand", async () => {
    const { fetcher, calls } = fetcherOf();
    const provider = host(
      settingsStore({ ...BERLIN, pollIntervalMs: 60_000 }),
      fetcher,
    );

    await sampleAt(provider, ["weather.temp"], Date.now());
    await settle();
    expect(calls()).toBe(1);

    // Ticks at every minute up to and including the thirtieth fetch; the
    // thirty-first is past the idle window and only stops the timer.
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(calls()).toBe(31);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls()).toBe(31);
  });
});
