# 0099 — Weather icons are vendored Meteocons bytes, and the weather provider owns its own clock

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/weather/`

## The problem

Two shapes had to be settled before the weather provider was written.

**Icons.** The vocabulary has a `mediaKind: "image"` key (`weather.icon`) whose
text is a host-relative URL, and the spec requires "a bundled open-licence SVG
set, one icon per code/day-night pair… If no icon maps, `weather.icon` is
unavailable rather than a generic wrong picture." The hard part is not drawing
an icon; it is a set that already distinguishes day from night across the 28
canonical WMO codes, has a licence that permits redistribution in a shipped
product, and renders on a background the set's authors never saw. An icon that
is invisible on a dark dashboard is a wrong picture too.

**Clocking.** Every other provider answers inside the host's poll cycle. Weather
must not: the consumer sets `pollIntervalMs` (default 10 min, permitted
1 min–24 h), the last good reading survives a window of failures, and no request
may leave this machine while no display demands a weather key.

## Rung 1 — Yunari

Searched: `packages/host/src/providers/` for anything fetching on a timer, and
the registry's scheduling.

Found: nothing. `registry.ts` calls `sample(keys, now, assignment)` on the host
cycle and every provider fetches inside that call (`library.ts`,
`lhm.ts`). The registry owns *which* keys are demanded, not a per-provider
cadence. So "the provider owns its clock" is a new owner, and it must be inside
the provider rather than a second scheduler beside the registry.

## Rung 2 — dependencies

Searched: installed packages for a weather client; `npm view openmeteo`,
`@meteocons/svg-static`, `weather-icons`.

Found: no weather client installed, and no need for one — the Open-Meteo
current+forecast payload is one GET with named fields. The official `openmeteo`
SDK exists and is MIT, but it adds a dependency to reshape JSON we read once
per ten minutes.

## Rung 3 — platform

Searched: the host's existing outbound HTTP (`fetch`, `AbortController`,
`redactForBrowser`), and the image path already built in Task 1.5.

Found: everything the acquisition needs — bounded fetch, abort, response size
cap, and a host-relative image URL that the player already resolves. Windows
Geolocator is the location fallback and is Task 3.5, not this decision.

## Rung 4 — ecosystem

Searched:
- `github.com/erikflowers/weather-icons` — 219 SVGs, day and night variants,
  and a built-in WMO 4680 mapping (`sass/mappings/wi-wmo4680.scss`).
- `github.com/basmilius/meteocons`, `@meteocons/svg-static` on npm, and the
  Meteocons manifest.
- `bootstrap-icons`, `tabler-icons` weather glyph families.
- `openmeteo` (official SDK) for the acquisition side.

Found: Weather Icons is the only set with a WMO mapping already done, but its
SVGs are unsized black glyphs with no fill (`wi-day-sunny.svg` has no `fill`
attribute), designed to be coloured through the icon font's CSS. Served as an
image — which is exactly what `weather.icon` is — they are black on whatever
background the theme drew. Meteocons 0.1.0 ships four styles; the `fill` style
is coloured art that reads on light and dark backgrounds and covers every WMO
distinction including `clear-day`/`clear-night`, `mostly-clear-*`,
`partly-cloudy-*`, `overcast-*`, `fog-*`, `drizzle`, `rain`, `sleet`, `snow`,
`hail`, `thunderstorms-*`. Its WMO mapping is ours to write, which is a closed
28-entry table, not a rabbit hole. Bootstrap and Tabler have too few weather
glyphs to distinguish the codes honestly; mapping six icons onto 28 codes is
the "generic wrong picture" the spec forbids.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Weather Icons (OFL-1.1) | WMO mapping built in | Vendoring 219 files; black glyphs served as `<img>` are invisible on dark themes | Wrong-looking product, not a bug anyone sees fail | Rejected |
| Meteocons `fill` (MIT) | Coloured, day/night complete, renders on any background | Our own 28-code map; 790 KB tarball for ~30 icons | Mapping mistakes are fixture-testable | **Chosen** |
| Bootstrap/Tabler (MIT) | Small, themeable | Not enough distinct conditions | Generic wrong picture | Rejected |
| Official `openmeteo` SDK | Official types | New dependency for one GET per 10 min | Unnecessary | Rejected |

## Rung 6 — probe

- `curl https://api.open-meteo.com/v1/forecast?…&timezone=auto` on 2026-10-24
  returned `current.temperature_2m` 11.3 °C, `apparent_temperature` 7.9,
  `relative_humidity_2m` 64 %, `precipitation` 0 mm, `weather_code` 3,
  `wind_speed_10m` 14.5 km/h, `wind_direction_10m` 161°, `is_day` 0, and
  `daily.temperature_2m_max`/`min` with `sunrise`/`sunset` as local wall times
  (`2026-10-24T07:47`, `2026-10-24T17:52`) plus `utc_offset_seconds`. Units were
  already metric; no unit parameter was needed.
- With `timezone=UTC` the same call returned wall times with no zone suffix and
  the daily bucket rolled to the UTC date — so the instant is derived from
  `utc_offset_seconds` rather than from a `Z` suffix or a UTC request.
- `npm view @meteocons/svg-static` reports version 0.1.0, MIT, 2080 files; the
  tarball downloaded at 790 KB and its `manifest.json` lists the slugs above;
  `package/LICENSE` is the MIT text.

## Decision

**Icons: Meteocons 0.1.0, `fill` style, vendored bytes.** The vendor script pins
the registry tarball and its `sha512` integrity, extracts a fixed allow-list of
slugs into `packages/host/vendor/weather-icons/`, and fails on a missing slug;
the committed bytes are what the route serves. The WMO→slug table lives with
the provider and is fixture-tested per code, day and night, so a missing
distinction surfaces as `unavailable` rather than a plausible wrong icon.

**Clock: the provider owns a timer, not the registry.** `sample()` is still a
pure cache read that records demand; the timer starts on the first sample that
demands a `weather.*` key, runs on `pollIntervalMs` from the settings store,
backing off on failure, and stops after the same window that makes a reading
stale. The registry keeps its one job — deciding which keys are demanded — and
a weather failure never delays the host's cycle.
