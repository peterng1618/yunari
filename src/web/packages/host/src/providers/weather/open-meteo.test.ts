import { afterEach, describe, expect, it, vi } from "vitest";
import { BERLIN, OPEN_METEO_BERLIN_CAPTURE } from "./open-meteo.fixture.js";
import {
  fetchOpenMeteo,
  OPEN_METEO_ATTRIBUTION,
  OPEN_METEO_ENDPOINT,
} from "./open-meteo.js";

function fetcherOf(
  body: BodyInit,
  status = 200,
): {
  fetcher: typeof fetch;
  asked: () => URL | undefined;
  init: () => RequestInit | undefined;
} {
  let asked: URL | undefined;
  let init: RequestInit | undefined;

  return {
    asked: () => asked,
    init: () => init,
    fetcher: (async (input: string | URL | Request, options?: RequestInit) => {
      asked = new URL(String(input));
      init = options;
      return new Response(body, { status });
    }) as unknown as typeof fetch,
  };
}

const CAPTURE = JSON.stringify(OPEN_METEO_BERLIN_CAPTURE);

describe("fetchOpenMeteo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the documented endpoint in metric units", async () => {
    const { fetcher, asked, init } = fetcherOf(CAPTURE);

    await fetchOpenMeteo(fetcher, BERLIN);

    // A redirect is another host answering a request this PC made to
    // Open-Meteo, so the fetch must refuse to follow one.
    expect(init()?.redirect).toBe("error");
    expect(init()?.signal).toBeInstanceOf(AbortSignal);
    const url = asked();
    expect(url === undefined ? "" : url.origin + url.pathname).toBe(
      OPEN_METEO_ENDPOINT,
    );
    expect(url?.searchParams.get("latitude")).toBe("52.52");
    expect(url?.searchParams.get("longitude")).toBe("13.41");
    expect(url?.searchParams.get("current")).toBe(
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day,pressure_msl",
    );
    expect(url?.searchParams.get("daily")).toBe(
      "temperature_2m_max,temperature_2m_min,sunrise,sunset",
    );
    expect(url?.searchParams.get("timezone")).toBe("auto");
    expect(url?.searchParams.get("forecast_days")).toBe("1");
    // Metric is the endpoint's default; a unit parameter would be a second
    // spelling of a decision the request already made.
    expect(url?.searchParams.has("temperature_unit")).toBe(false);
    expect(url?.searchParams.has("wind_speed_unit")).toBe(false);
  });

  it("normalizes the capture into one reading", async () => {
    const reading = await fetchOpenMeteo(fetcherOf(CAPTURE).fetcher, BERLIN);

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
    expect(OPEN_METEO_ATTRIBUTION).toBe("Weather data by Open-Meteo.com");
  });

  it("refuses a non-2xx answer without naming the endpoint's address", async () => {
    await expect(
      fetchOpenMeteo(fetcherOf("no", 503).fetcher, BERLIN),
    ).rejects.toThrow(/HTTP 503/);
    await expect(
      fetchOpenMeteo(fetcherOf("no", 503).fetcher, BERLIN),
    ).rejects.not.toThrow(/https?:\/\//);
  });

  it("aborts a body past the one-mebibyte cap", async () => {
    await expect(
      fetchOpenMeteo(fetcherOf("x".repeat(1024 * 1024 + 1)).fetcher, BERLIN),
    ).rejects.toThrow(/more than it should/);
  });

  it("refuses a body that is not JSON", async () => {
    await expect(
      fetchOpenMeteo(fetcherOf("not json").fetcher, BERLIN),
    ).rejects.toThrow(/something unexpected/);
  });

  it("refuses a reading with a missing field rather than inventing zero", async () => {
    const broken = structuredClone(OPEN_METEO_BERLIN_CAPTURE) as {
      current: Record<string, unknown>;
    };
    delete broken.current["pressure_msl"];

    await expect(
      fetchOpenMeteo(fetcherOf(JSON.stringify(broken)).fetcher, BERLIN),
    ).rejects.toThrow(/pressure_msl/);
  });

  it("reads daylight from is_day", async () => {
    const daylight = structuredClone(OPEN_METEO_BERLIN_CAPTURE) as {
      current: { is_day: number };
    };
    daylight.current.is_day = 1;

    const reading = await fetchOpenMeteo(
      fetcherOf(JSON.stringify(daylight)).fetcher,
      BERLIN,
    );

    expect(reading.isDay).toBe(true);
  });

  it("aborts a request after ten seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let settle: ((response: Response) => void) | undefined;

    const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        settle = resolve;
      });
    }) as unknown as typeof fetch;

    const pending = fetchOpenMeteo(fetcher, BERLIN);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(signal?.aborted).toBe(true);

    // Settle the fetch so the rejected promise is observed rather than left
    // pending; the abort is what this case binds.
    settle?.(new Response("{}"));
    await expect(pending).rejects.toThrow(/unexpected/);
  });
});
