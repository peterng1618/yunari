import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BERLIN_CAPTURE_TIME_MS,
  OPENWEATHERMAP_CURRENT_BERLIN_CAPTURE,
  OPENWEATHERMAP_FORECAST_BERLIN_CAPTURE,
  WEATHERAPI_BERLIN_CAPTURE,
} from "./backends.fixture.js";
import { WEATHER_BACKENDS } from "./backends.js";
import { BERLIN, OPEN_METEO_BERLIN_CAPTURE } from "./open-meteo.fixture.js";
import { fetchOpenWeatherMap } from "./openweathermap.js";
import { fetchWeatherApi } from "./weatherapi.js";

const SECRET = "sk-secret-1234";

function fetcherOf(respond: (url: URL, call: number) => Response): {
  fetcher: typeof fetch;
  calls: URL[];
} {
  const calls: URL[] = [];

  return {
    calls,
    fetcher: (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url);
      return respond(url, calls.length - 1);
    }) as unknown as typeof fetch,
  };
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const currentAnswer = () => ok(OPENWEATHERMAP_CURRENT_BERLIN_CAPTURE);
const forecastAnswer = () => ok(OPENWEATHERMAP_FORECAST_BERLIN_CAPTURE);

/** The six named canonical groups; each case is one backend code and the WMO
 *  code it must land on. */
const WEATHERAPI_GROUPS: readonly [string, number, number][] = [
  ["clear", 1000, 0],
  ["cloudy", 1006, 2],
  ["rain", 1183, 61],
  ["thunderstorm", 1276, 96],
  ["snow", 1225, 75],
  ["fog", 1135, 45],
];

const OPENWEATHERMAP_GROUPS: readonly [string, number, number][] = [
  ["clear", 800, 0],
  ["cloudy", 802, 2],
  ["rain", 501, 63],
  ["thunderstorm", 211, 95],
  ["snow", 601, 73],
  ["fog", 741, 45],
];

describe("WEATHER_BACKENDS", () => {
  it("carries all three ids with their own attribution", () => {
    expect(Object.keys(WEATHER_BACKENDS).sort()).toEqual([
      "open-meteo",
      "openweathermap",
      "weatherapi",
    ]);
    expect(WEATHER_BACKENDS["open-meteo"].attribution).toBe(
      "Weather data by Open-Meteo.com",
    );
    expect(WEATHER_BACKENDS.weatherapi.attribution).toBe(
      "Powered by WeatherAPI.com",
    );
    expect(WEATHER_BACKENDS.openweathermap.attribution).toBe(
      "Weather data provided by OpenWeather",
    );
  });

  it("lets the keyless backend ignore a key rather than send it", async () => {
    const { fetcher, calls } = fetcherOf(() => ok(OPEN_METEO_BERLIN_CAPTURE));

    await WEATHER_BACKENDS["open-meteo"].fetch(BERLIN, fetcher, SECRET);

    expect(calls[0]?.searchParams.has("key")).toBe(false);
    expect(calls[0]?.searchParams.has("appid")).toBe(false);
  });
});

describe("WeatherAPI backend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BERLIN_CAPTURE_TIME_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the forecast endpoint for metric fields with the key in the query", async () => {
    const { fetcher, calls } = fetcherOf(() => ok(WEATHERAPI_BERLIN_CAPTURE));

    await fetchWeatherApi(BERLIN, fetcher, SECRET);

    const url = calls[0];
    expect(url === undefined ? "" : url.origin + url.pathname).toBe(
      "https://api.weatherapi.com/v1/forecast.json",
    );
    expect(url?.searchParams.get("key")).toBe(SECRET);
    expect(url?.searchParams.get("q")).toBe("52.52,13.41");
    expect(url?.searchParams.get("days")).toBe("1");
    expect(url?.searchParams.get("aqi")).toBe("no");
    expect(url?.searchParams.get("alerts")).toBe("no");
    expect(url?.searchParams.get("lang")).toBe("en");
  });

  it("normalizes the capture, including both sun times as instants", async () => {
    const reading = await fetchWeatherApi(
      BERLIN,
      fetcherOf(() => ok(WEATHERAPI_BERLIN_CAPTURE)).fetcher,
      SECRET,
    );

    expect(reading).toEqual({
      tempC: 11.3,
      feelsLikeC: 7.9,
      highC: 11.6,
      lowC: 6.7,
      humidity: 64,
      pressureHpa: 1006.7,
      precipitationMm: 0,
      windKph: 14.5,
      windDeg: 161,
      code: 3,
      isDay: false,
      sunriseIso: "2026-10-24T05:47:00.000Z",
      sunsetIso: "2026-10-24T15:52:00.000Z",
    });
  });

  it.each(WEATHERAPI_GROUPS)(
    "maps the %s group onto the canonical code",
    async (_group, ownCode, canonical) => {
      const answer = structuredClone(WEATHERAPI_BERLIN_CAPTURE) as {
        current: { condition: { code: number } };
      };
      answer.current.condition.code = ownCode;

      const reading = await fetchWeatherApi(
        BERLIN,
        fetcherOf(() => ok(answer)).fetcher,
        SECRET,
      );

      expect(reading.code).toBe(canonical);
    },
  );

  it("fails an unmapped code by number, never a neighbouring condition", async () => {
    const answer = structuredClone(WEATHERAPI_BERLIN_CAPTURE) as {
      current: { condition: { code: number } };
    };
    answer.current.condition.code = 1234;

    await expect(
      fetchWeatherApi(BERLIN, fetcherOf(() => ok(answer)).fetcher, SECRET),
    ).rejects.toThrow(/1234/);
  });

  it("makes no request when the key is absent, and names the credential", async () => {
    const { fetcher, calls } = fetcherOf(() => ok(WEATHERAPI_BERLIN_CAPTURE));

    await expect(fetchWeatherApi(BERLIN, fetcher, undefined)).rejects.toThrow(
      /weatherapi/,
    );
    expect(calls).toHaveLength(0);
  });

  it("names a rejected key without echoing it or the host", async () => {
    const { fetcher } = fetcherOf(
      () => new Response("denied", { status: 401 }),
    );

    const failure = fetchWeatherApi(BERLIN, fetcher, SECRET);

    await expect(failure).rejects.toThrow(/weatherapi/i);
    await expect(failure).rejects.not.toThrow(new RegExp(SECRET));
    await expect(failure).rejects.not.toThrow(/weatherapi\.com/);
  });
});

describe("OpenWeatherMap backend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BERLIN_CAPTURE_TIME_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the current and forecast endpoints in metric units", async () => {
    const { fetcher, calls } = fetcherOf((_url, call) =>
      call === 0 ? currentAnswer() : forecastAnswer(),
    );

    await fetchOpenWeatherMap(BERLIN, fetcher, SECRET);

    expect(calls.map((url) => url.pathname)).toEqual([
      "/data/2.5/weather",
      "/data/2.5/forecast",
    ]);
    for (const url of calls) {
      expect(url.origin).toBe("https://api.openweathermap.org");
      expect(url.searchParams.get("lat")).toBe("52.52");
      expect(url.searchParams.get("lon")).toBe("13.41");
      expect(url.searchParams.get("units")).toBe("metric");
      expect(url.searchParams.get("appid")).toBe(SECRET);
    }
  });

  it("normalizes m/s wind, pressure and the absent rain field", async () => {
    const reading = await fetchOpenWeatherMap(
      BERLIN,
      fetcherOf((_url, call) =>
        call === 0 ? currentAnswer() : forecastAnswer(),
      ).fetcher,
      SECRET,
    );

    expect(reading.tempC).toBe(11.3);
    expect(reading.feelsLikeC).toBe(7.9);
    expect(reading.humidity).toBe(64);
    expect(reading.pressureHpa).toBe(1006.7);
    // `wind.speed` is m/s in the metric request; the vocabulary wants km/h.
    expect(reading.windKph).toBeCloseTo(14.508, 3);
    expect(reading.windDeg).toBe(161);
    // No `rain` key means the service reports no rain, which is 0 mm.
    expect(reading.precipitationMm).toBe(0);
    expect(reading.sunriseIso).toBe("2026-10-24T05:47:00.000Z");
    expect(reading.sunsetIso).toBe("2026-10-24T15:52:00.000Z");
    expect(reading.isDay).toBe(false);
  });

  it("takes today's high and low by the city's own date, not UTC", async () => {
    const reading = await fetchOpenWeatherMap(
      BERLIN,
      fetcherOf((_url, call) =>
        call === 0 ? currentAnswer() : forecastAnswer(),
      ).fetcher,
      SECRET,
    );

    // The 99/-99 rows are yesterday and tomorrow in UTC+2.
    expect(reading.highC).toBe(11.8);
    expect(reading.lowC).toBe(6.2);
  });

  it.each(OPENWEATHERMAP_GROUPS)(
    "maps the %s group onto the canonical code",
    async (_group, ownCode, canonical) => {
      const answer = structuredClone(
        OPENWEATHERMAP_CURRENT_BERLIN_CAPTURE,
      ) as unknown as { weather: { id: number }[] };
      answer.weather[0]!.id = ownCode;

      const reading = await fetchOpenWeatherMap(
        BERLIN,
        fetcherOf((_url, call) => (call === 0 ? ok(answer) : forecastAnswer()))
          .fetcher,
        SECRET,
      );

      expect(reading.code).toBe(canonical);
    },
  );

  it("fails an unmapped code by number", async () => {
    const answer = structuredClone(
      OPENWEATHERMAP_CURRENT_BERLIN_CAPTURE,
    ) as unknown as {
      weather: { id: number }[];
    };
    answer.weather[0]!.id = 771;

    await expect(
      fetchOpenWeatherMap(
        BERLIN,
        fetcherOf((_url, call) => (call === 0 ? ok(answer) : forecastAnswer()))
          .fetcher,
        SECRET,
      ),
    ).rejects.toThrow(/771/);
  });

  it("makes no request when the key is absent, and names the credential", async () => {
    const { fetcher, calls } = fetcherOf(() => currentAnswer());

    await expect(
      fetchOpenWeatherMap(BERLIN, fetcher, undefined),
    ).rejects.toThrow(/openweathermap/);
    expect(calls).toHaveLength(0);
  });

  it("names a rejected key without echoing it or the host", async () => {
    const { fetcher } = fetcherOf(
      () => new Response("denied", { status: 401 }),
    );

    const failure = fetchOpenWeatherMap(BERLIN, fetcher, SECRET);

    await expect(failure).rejects.toThrow(/openweathermap/i);
    await expect(failure).rejects.not.toThrow(new RegExp(SECRET));
    await expect(failure).rejects.not.toThrow(/openweathermap\.org/);
  });
});
