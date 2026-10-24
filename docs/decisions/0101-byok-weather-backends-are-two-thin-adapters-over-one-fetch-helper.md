# 0101 — BYOK weather backends are two thin adapters over one fetch helper

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/weather/weatherapi.ts`,
  `src/web/packages/host/src/providers/weather/openweathermap.ts`,
  `src/web/packages/host/src/providers/weather/backends.ts`,
  `src/web/packages/host/src/providers/weather/backends.fixture.ts`,
  `src/web/packages/host/src/providers/weather/open-meteo.ts`,
  `src/web/packages/host/src/providers/weather/provider.ts`,
  `src/web/packages/host/src/settings/credentials-registry.ts`,
  `src/web/packages/host/src/main.ts`

## The problem

Three weather services have to answer one `WeatherReading`. The shape is not
"call an endpoint": each service names the same quantity differently, reports a
different condition vocabulary, and sends a key in a different place. Two of
them charge a key, so a missing key must make no request at all, and a refused
key must reach a display without the key, the URL or the host. The host already
has one weather acquisition path (decision 0099) with a timeout, a body cap, a
redirect refusal and redaction; a second copy of any of those would drift.

## Rung 1 — Yunari

Searched: `src/web/packages/host/src/providers/` for every fetch with a
timeout/redirect policy, and the tree for any condition-code table.

Found: `open-meteo.ts` owns the only weather fetch, with `TIMEOUT_MS`,
`MAX_BODY_BYTES`, `redirect: "error"` and chunked body reading. `conditions.ts`
owns the canonical WMO vocabulary but no outer mapping. `credentials-registry.ts`
owns the credential table and `unsplash.ts` is the one existing `verify` shape.
Nothing reads `weatherapi` or `openweathermap`; no second weather adapter exists.

## Rung 2 — dependencies

Searched: the host manifest and the workspace manifests for an HTTP client, a
weather SDK or a unit-conversion package.

Found: none. `@yunari/host` declares only workspace packages, `ffmpeg-static`,
`node-forge` and `systeminformation`; HTTP is native `fetch`. A weather SDK
would be a new shipped dependency for two URLs and two integer tables, which
the task forbids and which would also own the fetch policy the host must keep.

## Rung 3 — platform

Searched: `fetch`/`AbortController`/`URL`/`URLSearchParams`, and `Intl` for unit
or condition naming.

Found: native `fetch` covers both services, `URL` builds the query safely, and
the existing abort-plus-`clearTimeout` pattern is what the suite can advance.
`Intl` has no weather-condition vocabulary and no unit conversion; both are
tables, and the canonical table already exists.

## Rung 4 — ecosystem

Searched: npm for `openmeteo`, `weatherapi`, `openweathermap` clients and the
services' own documented examples.

Found: each service publishes request/response examples and client wrappers,
but every wrapper embeds its own `fetch`, timeout and error wording and returns
the service's own condition vocabulary. Adopting one would still require the
same mapping table, and would replace a fetch path the host already hardens.

## Rung 5 — comparison

| Option | Fits | Rejected because |
|---|---|---|
| Weather SDK per service | request building | new dependency; owns fetch policy; still needs the code map |
| One generic HTTP helpers package | fetch | new dependency for ~40 lines; the host's policy is the valuable part |
| Two adapters over `open-meteo.ts`'s exported helper | fetch policy, testability | chosen: one timeout, one cap, one redaction boundary |

## Rung 6 — probe

Probed with fixtures: the two documented payloads trimmed to the fields the
task names, driven through the adapter with a stubbed `fetch`. The suite asserts
the six canonical condition groups, an unmapped code failing by number, a
missing key making zero calls, a 401 carrying no key, WeatherAPI's 12-hour sun
strings becoming instants, and OpenWeatherMap's m/s wind and local-day
high/low bucketing at UTC+2.

## Rung 7 — build

Built: `backends.ts` (the `WeatherBackend` table the provider selects from),
`weatherapi.ts` and `openweathermap.ts` (URL + mapping + reading),
`open-meteo.ts` exports the shared `fetchWeatherJson`/number/object readers, and
`provider.ts` reads the credential per poll. No fallback branch exists: a
missing key is an error naming the credential, never another backend's request.
