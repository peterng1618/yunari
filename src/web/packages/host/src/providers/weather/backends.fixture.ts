/**
 * Trimmed payloads for the two BYOK weather backends, 2026-10-24.
 *
 * No live key was used: each object holds only the fields the task's rulings
 * name, in the shape the provider documents. Berlin and its numbers mirror the
 * Open-Meteo capture beside this file so the three backends read side by side.
 */

/** WeatherAPI `forecast.json`, documented at
 *  <https://www.weatherapi.com/docs/forecast-api/>. `localtime_epoch` is the
 *  local wall clock read as an epoch, so the request instant is
 *  2026-10-23T22:45:00Z at UTC+2. */
export const WEATHERAPI_BERLIN_CAPTURE = {
  location: {
    name: "Berlin",
    region: "Berlin",
    country: "Germany",
    lat: 52.52,
    lon: 13.41,
    tz_id: "Europe/Berlin",
    localtime_epoch: 1792802700,
    localtime: "2026-10-24 0:45",
  },
  current: {
    temp_c: 11.3,
    feelslike_c: 7.9,
    humidity: 64,
    pressure_mb: 1006.7,
    precip_mm: 0,
    wind_kph: 14.5,
    wind_degree: 161,
    condition: { code: 1009, text: "Overcast" },
    is_day: 0,
  },
  forecast: {
    forecastday: [
      {
        date: "2026-10-24",
        day: { maxtemp_c: 11.6, mintemp_c: 6.7 },
        astro: { sunrise: "07:47 AM", sunset: "05:52 PM" },
      },
    ],
  },
} as const;

/** OpenWeatherMap `data/2.5/weather` and `data/2.5/forecast`, documented at
 *  <https://openweathermap.org/current> and
 *  <https://openweathermap.org/forecast5>. The forecast list brackets today in
 *  `city.timezone` (7200) and carries two decoy rows on the neighbouring local
 *  dates, whose 99/-99 values must not become today's high or low. */
export const OPENWEATHERMAP_CURRENT_BERLIN_CAPTURE = {
  weather: [{ id: 803, main: "Clouds", description: "broken clouds" }],
  main: {
    temp: 11.3,
    feels_like: 7.9,
    temp_min: 6.7,
    temp_max: 11.6,
    pressure: 1006.7,
    humidity: 64,
  },
  wind: { speed: 4.03, deg: 161 },
  sys: { sunrise: 1792820820, sunset: 1792857120 },
  timezone: 7200,
} as const;

export const OPENWEATHERMAP_FORECAST_BERLIN_CAPTURE = {
  city: { name: "Berlin", timezone: 7200 },
  list: [
    // 2026-10-23 23:00 local: yesterday, so neither value may be used.
    { dt: 1792789200, main: { temp_max: 99, temp_min: -99 } },
    // 2026-10-24 00:00 local.
    { dt: 1792792800, main: { temp_max: 11.6, temp_min: 6.7 } },
    // 2026-10-24 03:00 local.
    { dt: 1792803600, main: { temp_max: 11.8, temp_min: 6.2 } },
    // 2026-10-25 00:00 local: tomorrow.
    { dt: 1792879200, main: { temp_max: 99, temp_min: -99 } },
  ],
} as const;

/** The instant both captures describe: 2026-10-24 00:45 in Berlin (UTC+2). */
export const BERLIN_CAPTURE_TIME_MS = Date.parse("2026-10-23T22:45:00.000Z");
