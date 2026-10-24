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

/** Every WeatherAPI code the backend maps, with its canonical WMO code. The
 *  table is the test's own reading of the ruling, not the module's map: a typo
 *  in any entry has to show up here as well as there. */
const WEATHERAPI_CODES: readonly [number, number][] = [
  [1000, 0],
  [1003, 1],
  [1006, 2],
  [1009, 3],
  [1030, 45],
  [1135, 45],
  [1147, 48],
  [1087, 95],
  [1114, 75],
  [1117, 75],
  [1150, 51],
  [1153, 51],
  [1168, 56],
  [1171, 57],
  [1180, 61],
  [1183, 61],
  [1186, 63],
  [1189, 63],
  [1192, 65],
  [1195, 65],
  [1198, 66],
  [1201, 67],
  [1204, 66],
  [1207, 67],
  [1210, 71],
  [1213, 71],
  [1216, 73],
  [1219, 73],
  [1222, 75],
  [1225, 75],
  [1237, 77],
  [1240, 80],
  [1243, 81],
  [1246, 82],
  [1249, 66],
  [1252, 67],
  [1255, 85],
  [1258, 86],
  [1261, 85],
  [1264, 86],
  [1273, 95],
  [1276, 96],
  [1279, 95],
  [1282, 99],
];

/** Every OpenWeatherMap id the backend maps. */
const OPENWEATHERMAP_CODES: readonly [number, number][] = [
  [800, 0],
  [801, 1],
  [802, 2],
  [803, 3],
  [804, 3],
  [200, 95],
  [201, 95],
  [202, 95],
  [210, 95],
  [211, 95],
  [212, 95],
  [221, 95],
  [230, 95],
  [231, 95],
  [232, 96],
  [300, 51],
  [301, 51],
  [302, 53],
  [310, 53],
  [311, 53],
  [312, 55],
  [313, 55],
  [314, 55],
  [321, 55],
  [500, 61],
  [501, 63],
  [502, 65],
  [503, 65],
  [504, 65],
  [511, 66],
  [520, 80],
  [521, 81],
  [522, 82],
  [531, 81],
  [600, 71],
  [601, 73],
  [602, 75],
  [611, 66],
  [612, 66],
  [613, 67],
  [615, 66],
  [616, 67],
  [620, 85],
  [621, 86],
  [622, 86],
  [701, 45],
  [711, 45],
  [721, 45],
  [731, 45],
  [741, 45],
  [751, 45],
  [761, 45],
  [762, 45],
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
    expect(WEATHER_BACKENDS["open-meteo"].termsUrl).toBe(
      "https://open-meteo.com/en/licence",
    );
    expect(WEATHER_BACKENDS.weatherapi.termsUrl).toBe(
      "https://www.weatherapi.com/",
    );
    expect(WEATHER_BACKENDS.openweathermap.termsUrl).toBe(
      "https://openweathermap.org/",
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

  it.each(WEATHERAPI_CODES)(
    "maps WeatherAPI code %i onto canonical code %i",
    async (ownCode, canonical) => {
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
      () => new Response(`denied for ${SECRET}`, { status: 401 }),
    );

    const failure = fetchWeatherApi(BERLIN, fetcher, SECRET);

    await expect(failure).rejects.toThrow(/weatherapi/i);
    // The stub's body carries the key, so any reading of it would show here.
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

  it.each(OPENWEATHERMAP_CODES)(
    "maps OpenWeatherMap id %i onto canonical code %i",
    async (ownCode, canonical) => {
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

  it("falls back to the current answer's range when the list has no today row", async () => {
    const forecast = {
      city: { name: "Berlin", timezone: 7200 },
      // Both rows are the neighbouring local dates, so "today" is absent.
      list: [
        { dt: 1792789200, main: { temp_max: 99, temp_min: -99 } },
        { dt: 1792879200, main: { temp_max: 99, temp_min: -99 } },
      ],
    };

    const reading = await fetchOpenWeatherMap(
      BERLIN,
      fetcherOf((_url, call) => (call === 0 ? currentAnswer() : ok(forecast)))
        .fetcher,
      SECRET,
    );

    expect(reading.highC).toBe(11.6);
    expect(reading.lowC).toBe(6.7);
  });

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
      () => new Response(`denied for ${SECRET}`, { status: 401 }),
    );

    const failure = fetchOpenWeatherMap(BERLIN, fetcher, SECRET);

    await expect(failure).rejects.toThrow(/openweathermap/i);
    // The stub's body carries the key, so any reading of it would show here.
    await expect(failure).rejects.not.toThrow(new RegExp(SECRET));
    await expect(failure).rejects.not.toThrow(/openweathermap\.org/);
  });
});
