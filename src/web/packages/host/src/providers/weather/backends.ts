/**
 * The weather backends a host can acquire from, selected explicitly by
 * `weather.json`'s `provider`.
 *
 * There is no fallback between them: spending a different account's quota
 * because this one's key is missing is the failure the spec names, so a
 * missing key is an error naming that credential.
 */

import type { WeatherProviderId } from "../../settings/weather.js";
import {
  fetchOpenMeteo,
  OPEN_METEO_ATTRIBUTION,
  type WeatherLocation,
  type WeatherReading,
} from "./open-meteo.js";
import {
  fetchOpenWeatherMap,
  OPENWEATHERMAP_ATTRIBUTION,
} from "./openweathermap.js";
import { fetchWeatherApi, WEATHERAPI_ATTRIBUTION } from "./weatherapi.js";

export interface WeatherBackend {
  readonly id: WeatherProviderId;
  readonly attribution: string;
  fetch(
    location: WeatherLocation,
    fetchImpl: typeof fetch,
    key: string | undefined,
  ): Promise<WeatherReading>;
}

export const WEATHER_BACKENDS = {
  "open-meteo": {
    id: "open-meteo",
    attribution: OPEN_METEO_ATTRIBUTION,
    // The keyless backend ignores a key rather than sending one.
    fetch: (location, fetchImpl, _key) => fetchOpenMeteo(fetchImpl, location),
  },
  weatherapi: {
    id: "weatherapi",
    attribution: WEATHERAPI_ATTRIBUTION,
    fetch: (location, fetchImpl, key) =>
      fetchWeatherApi(location, fetchImpl, key),
  },
  openweathermap: {
    id: "openweathermap",
    attribution: OPENWEATHERMAP_ATTRIBUTION,
    fetch: (location, fetchImpl, key) =>
      fetchOpenWeatherMap(location, fetchImpl, key),
  },
} as const satisfies Readonly<Record<WeatherProviderId, WeatherBackend>>;
