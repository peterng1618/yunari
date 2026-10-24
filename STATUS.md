# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **Phases 1–5 are complete** (Tasks 1.1–1.5, 2.1–2.4, 3.1–3.5, 4.1–4.3, 5.1–5.5); the Phase 5 gate ran green.
- **Phase 6 is complete** (6.1–6.4): frame statistics, game presence and local box art all answer; the agent-implemented tasks are done.
- **Custom sources are proven end to end**: authored in Host mode, discovered by the inspector, rendered on a display, and explained when deleted.
- **Media is live end to end**: real Chrome session title/artist/state/position/duration, artwork bytes through the authed route, and `audio.volume`/`audio.muted` from the render endpoint.

## Last completed change

- **Task 6.4**: `/api/game/artwork/<appId>.jpg` serves Steam's local `librarycache/<appId>/library_600x900.jpg`; `game.artwork` gives that URL when the running app has one and is unavailable otherwise.
- **Route refuses** malformed or uninstalled app ids, bounds reads at 5 MiB, and mirrors media artwork's loopback-or-paired-display gate with a `private, max-age=3600` cache.
- **Evidence:** 323 focused host tests, host and e2e typechecks, biome, host and editor builds exit 0; the e2e decoded the cached JPEG then restored the authored SVG.
- **Decision 0108 extended** (no second ADR): `server.ts` claimed, local-only serving recorded as a privacy decision against a Steam CDN request.
- **Real-library probe:** 16 of 19 installed apps have the 600x900 file; `228980`, `292030` and `990080` do not.

## Next

1. Run the full gate and the Phase 6 gate.
2. Close the sensor-platform plan and spec.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response** has run; both need user keys, and **Windows Geolocator** from a host-spawned PowerShell is unrun.
- **Frame and game presence are unverified live:** RTSS is not running, PresentMon is not installed, and no game ran during Task 6.3 (Steam's 19 manifests and the foreground helper were probed).
- **Credential removal from the Sources page** is jsdom-tested only; the real `DELETE /api/credentials/:id` path never ran in a browser.
- **jpg/webp artwork** is unverified; the live proof covered one PNG, and graceful helper shutdown on host exit is unit-tested only.
- **A source added while the editor is open** is not in the Reads picker until a reload (vg-713).
