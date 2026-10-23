import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWeatherSettingsStore,
  DEFAULT_WEATHER_SETTINGS,
  normalizeWeatherSettings,
} from "./weather.js";

describe("weather settings", () => {
  let dir: string;

  /** A stored place, which the cases vary one field of. The defaults carry no
   *  label, so they are not a base a save can round-trip from. */
  const PLACED = {
    ...DEFAULT_WEATHER_SETTINGS,
    label: "Berlin, Berlin, DE",
    latitude: 52.52,
    longitude: 13.41,
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-weather-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a missing file as the defaults, with no problem to report", async () => {
    const store = createWeatherSettingsStore(dir);

    expect(await store.read()).toEqual(DEFAULT_WEATHER_SETTINGS);
    expect(store.problem()).toBeUndefined();
  });

  it("refuses a latitude outside the world, naming the field", () => {
    expect(() => normalizeWeatherSettings({ ...PLACED, latitude: 91 })).toThrow(
      /latitude/,
    );
    expect(() =>
      normalizeWeatherSettings({ ...PLACED, latitude: -91 }),
    ).toThrow(/latitude/);
  });

  it("refuses an empty label, naming the field", () => {
    expect(() => normalizeWeatherSettings({ ...PLACED, label: "  " })).toThrow(
      /label/,
    );
  });

  it("refuses a provider this host does not know, naming the field", () => {
    expect(() =>
      normalizeWeatherSettings({ ...PLACED, provider: "nws" }),
    ).toThrow(/provider/);
  });

  it("refuses an interval shorter than a minute, naming the field", () => {
    expect(() =>
      normalizeWeatherSettings({
        ...PLACED,
        pollIntervalMs: 59999,
      }),
    ).toThrow(/pollIntervalMs/);
  });

  it("defaults the provider and keeps the boundaries the spec allows", () => {
    expect(
      normalizeWeatherSettings({
        label: "Berlin",
        latitude: -90,
        longitude: 180,
        pollIntervalMs: 86400000,
      }),
    ).toEqual({
      provider: "open-meteo",
      label: "Berlin",
      latitude: -90,
      longitude: 180,
      useWindowsLocation: false,
      pollIntervalMs: 86400000,
    });
  });

  it("reads an absent label as no manual place, and stores it without one", async () => {
    expect(normalizeWeatherSettings({})).toEqual(DEFAULT_WEATHER_SETTINGS);

    const store = createWeatherSettingsStore(dir);
    expect(await store.write({})).toEqual(DEFAULT_WEATHER_SETTINGS);

    // The file it wrote is one it can read back: an unset place is an absent
    // field, which is not the empty label the normalizer refuses.
    expect(await store.read()).toEqual(DEFAULT_WEATHER_SETTINGS);
    expect(store.problem()).toBeUndefined();
    const stored = JSON.parse(
      await readFile(path.join(dir, "weather.json"), "utf8"),
    ) as Record<string, unknown>;
    expect("label" in stored).toBe(false);
  });

  it("round-trips through an atomic write", async () => {
    const store = createWeatherSettingsStore(dir);
    const written = {
      provider: "weatherapi" as const,
      label: "Berlin",
      latitude: 52.52,
      longitude: 13.41,
      useWindowsLocation: true,
      pollIntervalMs: 60000,
    };

    expect(await store.write(written)).toEqual(written);
    expect(await store.read()).toEqual(written);
    // The temp file is renamed over the target, never left beside it.
    expect(await readdir(dir)).toEqual(["weather.json"]);
  });

  it("refuses an invalid write without touching the stored file", async () => {
    const store = createWeatherSettingsStore(dir);
    await store.write({
      ...DEFAULT_WEATHER_SETTINGS,
      label: "Berlin",
      latitude: 52.52,
      longitude: 13.41,
    });

    await expect(store.write({ ...PLACED, latitude: 91 })).rejects.toThrow(
      /latitude/,
    );

    const stored = JSON.parse(
      await readFile(path.join(dir, "weather.json"), "utf8"),
    ) as { readonly latitude?: unknown };
    expect(stored.latitude).toBe(52.52);
  });

  it("reports a stored file it refuses as a problem, then clears it", async () => {
    const store = createWeatherSettingsStore(dir);
    await writeFile(path.join(dir, "weather.json"), "{ not json", "utf8");

    expect(await store.read()).toEqual(DEFAULT_WEATHER_SETTINGS);
    expect(store.problem()).toBeDefined();

    await store.write({ ...DEFAULT_WEATHER_SETTINGS, label: "Berlin" });
    expect(store.problem()).toBeUndefined();
    expect(await store.read()).toEqual({
      ...DEFAULT_WEATHER_SETTINGS,
      label: "Berlin",
    });
  });

  it("reports a valid file's field the normalizer refuses as a problem", async () => {
    const store = createWeatherSettingsStore(dir);
    await writeFile(
      path.join(dir, "weather.json"),
      JSON.stringify({ ...PLACED, latitude: 91 }),
      "utf8",
    );

    expect(await store.read()).toEqual(DEFAULT_WEATHER_SETTINGS);
    expect(store.problem()).toMatch(/latitude/);
  });
});
