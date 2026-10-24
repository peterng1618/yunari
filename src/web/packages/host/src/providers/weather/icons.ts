/**
 * WMO code → vendored Meteocons `fill` slug, one entry per canonical code.
 *
 * The allow-list is also the route's allow-list: a name that is not one of
 * these is a 404, never a neighbouring picture. Decision 0099 records why the
 * set is vendored rather than fetched.
 *
 * A slug is present here only because the bytes were committed; the vendor
 * script fails if the tarball no longer carries it.
 */

export const VENDORED_ICON_SLUGS = [
  "clear-day",
  "clear-night",
  "mostly-clear-day",
  "mostly-clear-night",
  "partly-cloudy-day",
  "partly-cloudy-night",
  "overcast-day",
  "overcast-night",
  "fog-day",
  "fog-night",
  "fog",
  "drizzle",
  "sleet",
  "rain",
  "snow",
  "partly-cloudy-day-rain",
  "partly-cloudy-night-rain",
  "partly-cloudy-day-snow",
  "partly-cloudy-night-snow",
  "thunderstorms-day",
  "thunderstorms-night",
  "thunderstorms-day-rain",
  "thunderstorms-night-rain",
] as const;

type IconPair = { readonly day: string; readonly night: string };

/** A single-picture condition names the same file for both halves of the day. */
function both(slug: string): IconPair {
  return { day: slug, night: slug };
}

function pair(day: string, night: string): IconPair {
  return { day, night };
}

export const WMO_ICONS: Readonly<Record<number, IconPair>> = {
  0: pair("clear-day", "clear-night"),
  1: pair("mostly-clear-day", "mostly-clear-night"),
  2: pair("partly-cloudy-day", "partly-cloudy-night"),
  3: pair("overcast-day", "overcast-night"),
  45: pair("fog-day", "fog-night"),
  48: both("fog"),
  51: both("drizzle"),
  53: both("drizzle"),
  55: both("drizzle"),
  56: both("sleet"),
  57: both("sleet"),
  61: both("rain"),
  63: both("rain"),
  65: both("rain"),
  66: both("sleet"),
  67: both("sleet"),
  71: both("snow"),
  73: both("snow"),
  75: both("snow"),
  77: both("snow"),
  80: pair("partly-cloudy-day-rain", "partly-cloudy-night-rain"),
  81: both("rain"),
  82: both("rain"),
  85: pair("partly-cloudy-day-snow", "partly-cloudy-night-snow"),
  86: both("snow"),
  95: pair("thunderstorms-day", "thunderstorms-night"),
  96: pair("thunderstorms-day-rain", "thunderstorms-night-rain"),
  99: pair("thunderstorms-day-rain", "thunderstorms-night-rain"),
};

const VENDORED: ReadonlySet<string> = new Set(VENDORED_ICON_SLUGS);

/** True only for a slug whose bytes this build vendored, matched exactly. */
export function isVendoredWeatherIcon(slug: string): boolean {
  return VENDORED.has(slug);
}

/** The host-relative icon a reading names, or nothing when no picture maps. */
export function weatherIconUrl(
  code: number,
  isDay: boolean,
): string | undefined {
  const icons = WMO_ICONS[code];
  if (icons === undefined) return undefined;

  const slug = isDay ? icons.day : icons.night;
  return isVendoredWeatherIcon(slug)
    ? `/api/weather/icon/${slug}.svg`
    : undefined;
}
