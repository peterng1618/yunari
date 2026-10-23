/**
 * A real Open-Meteo capture for Berlin, 2026-10-24 — the probe recorded in
 * `docs/decisions/0099`. No test reaches the network.
 *
 * The current conditions are the values in the task's ruling 3 and the daily
 * figures are from the same request. `pressure_msl` is the one field the
 * original probe did not request: `weather.pressure` has no other source, so a
 * second capture of the same endpoint on the same day supplied it (1006.7 hPa).
 */
export const OPEN_METEO_BERLIN_CAPTURE = {
  latitude: 52.512604,
  longitude: 13.419517,
  generationtime_ms: 0.2974271774291992,
  utc_offset_seconds: 7200,
  timezone: "Europe/Berlin",
  timezone_abbreviation: "GMT+2",
  elevation: 38.0,
  current_units: {
    time: "iso8601",
    interval: "seconds",
    temperature_2m: "°C",
    apparent_temperature: "°C",
    relative_humidity_2m: "%",
    precipitation: "mm",
    weather_code: "wmo code",
    wind_speed_10m: "km/h",
    wind_direction_10m: "°",
    is_day: "",
    pressure_msl: "hPa",
  },
  current: {
    time: "2026-10-24T00:45",
    interval: 900,
    temperature_2m: 11.3,
    apparent_temperature: 7.9,
    relative_humidity_2m: 64,
    precipitation: 0.0,
    weather_code: 3,
    wind_speed_10m: 14.5,
    wind_direction_10m: 161,
    is_day: 0,
    pressure_msl: 1006.7,
  },
  daily_units: {
    time: "iso8601",
    temperature_2m_max: "°C",
    temperature_2m_min: "°C",
    sunrise: "iso8601",
    sunset: "iso8601",
  },
  daily: {
    time: ["2026-10-24"],
    temperature_2m_max: [11.6],
    temperature_2m_min: [6.7],
    sunrise: ["2026-10-24T07:47"],
    sunset: ["2026-10-24T17:52"],
  },
} as const;

export const BERLIN = { latitude: 52.52, longitude: 13.41 } as const;
