import {
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWeatherSettingsStore,
  DEFAULT_WEATHER_SETTINGS,
  normalizeWeatherSettings,
  searchWeatherPlaces,
} from "./weather.js";

// Pass-through spies: the store's own save is asserted on the calls it makes,
// because "only weather.json exists afterwards" is also true of a direct write.
vi.mock("node:fs/promises", { spy: true });

/** A geocoder that answers one body, for the mapping cases. */
function answering(body: unknown): typeof fetch {
  return (async (): Promise<Response> =>
    new Response(JSON.stringify(body))) as typeof fetch;
}

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

  it("refuses a null provider rather than reading it as the default", () => {
    // `null` is a value the writer sent, not the absence of one: a null that
    // became open-meteo would store a backend nobody chose.
    expect(() =>
      normalizeWeatherSettings({ ...PLACED, provider: null }),
    ).toThrow(/provider/);
  });

  it("refuses non-numbers and non-finite numbers, naming the field", () => {
    for (const field of ["latitude", "longitude", "pollIntervalMs"] as const) {
      for (const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "45",
        null,
        [],
      ]) {
        expect(
          () => normalizeWeatherSettings({ ...PLACED, [field]: value }),
          `${field} = ${String(value)}`,
        ).toThrow(new RegExp(field));
      }
    }
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

    // **The write is observed, not inferred from the directory.** A direct
    // `writeFile` to `weather.json` leaves the same listing, so the source of
    // the rename is the evidence that the crash-safe path was taken.
    const source = vi.mocked(writeFile).mock.calls.at(-1)?.[0];
    expect(String(source)).toMatch(/weather\.json\.[0-9a-f]{12}\.tmp$/);
    expect(vi.mocked(rename)).toHaveBeenCalledWith(
      source,
      path.join(dir, "weather.json"),
    );
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

  it("answers a repeat read of an unchanged file from one file read", async () => {
    const store = createWeatherSettingsStore(dir);
    await store.write({ ...PLACED });

    expect(await store.read()).toEqual(PLACED);
    const filesRead = vi.mocked(readFile).mock.calls.length;
    expect(await store.read()).toEqual(PLACED);
    // A poll is the store's main reader, so the file is parsed once, not per
    // display per tick.
    expect(vi.mocked(readFile).mock.calls.length).toBe(filesRead);
  });

  it("answers a missing file from the cache rather than re-statting it", async () => {
    const store = createWeatherSettingsStore(dir);

    expect(await store.read()).toEqual(DEFAULT_WEATHER_SETTINGS);
    const stats = vi.mocked(stat).mock.calls.length;
    expect(await store.read()).toEqual(DEFAULT_WEATHER_SETTINGS);
    expect(vi.mocked(stat).mock.calls.length).toBe(stats);
  });

  it("re-reads a file someone else changed", async () => {
    const store = createWeatherSettingsStore(dir);
    await store.write({ ...PLACED });
    expect(await store.read()).toEqual(PLACED);

    // A longer label, so the size alone would catch it even if the two writes
    // landed in the same millisecond.
    const changed = { ...PLACED, label: "Hamburg, Hamburg, DE" };
    await writeFile(
      path.join(dir, "weather.json"),
      JSON.stringify(changed),
      "utf8",
    );

    expect(await store.read()).toEqual(changed);
  });

  it("serves what a write stored without waiting for the stat to differ", async () => {
    const store = createWeatherSettingsStore(dir);
    await store.write({ ...PLACED });
    expect(await store.read()).toEqual(PLACED);

    // Same encoded size as the record just read: only clearing the cache on the
    // write makes this read observe the new coordinate.
    const rewritten = { ...PLACED, latitude: 52.53 };
    await store.write(rewritten);
    const filesRead = vi.mocked(readFile).mock.calls.length;
    expect(await store.read()).toEqual(rewritten);
    expect(vi.mocked(readFile).mock.calls.length).toBe(filesRead + 1);
  });
});

describe("weather geocoding", () => {
  it("sends the search term as one encoded parameter of Open-Meteo's query", async () => {
    let asked: URL | undefined;
    let init: RequestInit | undefined;

    const places = await searchWeatherPlaces(
      (async (input, options): Promise<Response> => {
        asked = new URL(String(input));
        init = options;
        return new Response(JSON.stringify({ results: [] }));
      }) as typeof fetch,
      // A `&` would become a second parameter and a `#` would start a fragment
      // if the term were interpolated instead of set as a parameter.
      "A&B #C",
    );

    expect(places).toEqual([]);
    expect(asked?.searchParams.get("name")).toBe("A&B #C");
    expect(asked?.searchParams.get("count")).toBe("5");
    expect(asked?.searchParams.get("language")).toBe("en");
    expect(asked?.searchParams.get("format")).toBe("json");
    // Following a redirect would let another host answer this request.
    expect(init?.redirect).toBe("error");
  });

  it("gives the geocoder five seconds and abandons it", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = ((
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        })) as typeof fetch;

      let settled = false;
      const pending = searchWeatherPlaces(fetcher, "Berlin");
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(5_000);

      expect(settled, "the request was still open after five seconds").toBe(
        true,
      );
      await expect(pending).rejects.toThrow(/could not reach Open-Meteo/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers no more than five places, whatever the reply held", async () => {
    const results = Array.from({ length: 7 }, (_, index) => ({
      name: `Place ${index}`,
      country_code: "DE",
      latitude: index,
      longitude: index,
    }));

    const places = await searchWeatherPlaces(answering({ results }), "Berlin");

    expect(places).toHaveLength(5);
    expect(places.at(-1)?.label).toBe("Place 4, DE");
  });

  it("answers an empty or absent result list as no places", async () => {
    // Neither shape is a failure: a search that found nothing is an answer,
    // and the form draws its own empty sentence from it.
    expect(
      await searchWeatherPlaces(answering({ results: [] }), "Nowhere"),
    ).toEqual([]);
    expect(await searchWeatherPlaces(answering({}), "Nowhere")).toEqual([]);
  });
});
