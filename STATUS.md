# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **All six phases are complete** (Tasks 1.1–6.4); the Phase 6 gate ran green.
- **The whole-branch review** against the spec's Acceptance 1–10 is the remaining step before integration.
- **Custom sources are proven end to end**: authored in Host mode, discovered by the inspector, rendered on a display, and explained when deleted.
- **Media is live end to end**: real Chrome session title/artist/state/position/duration, artwork bytes through the authed route, and `audio.volume`/`audio.muted` from the render endpoint.

## Last completed change

- **Phase 6 complete** (Tasks 6.1–6.4): RTSS shared-memory adapter, PresentMon console adapter with a vendored MIT binary, Steam game presence, and a loopback/display-gated box-art route.
- **Gate:** `npm run gate` exit 0 — web 369 test files / 5394 tests; store-worker 12 files / 72 tests.
- **Box art is local only** from `<steam>/appcache/librarycache/<appId>/library_600x900.jpg`; 16 of 19 installed apps have it, and the e2e proves the JPEG renders and the authored asset returns on unavailable.
- **Rulings:** 0107 frame adapters, 0108 game presence and box art (now also claims `server.ts`).
- **Filed:** vg-714 (every foreground process reads as a running game).

## Next

1. Run the final whole-branch review against Acceptance 1–10.
2. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 is now used.
3. Run a live adapter check with a game (RTSS or PresentMon) when the user can start one.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response**, no live Open-Meteo run and no Windows Geolocator run; fixtures and units are tested only.
- **No live frame or game reading:** RTSS is installed but not running, PresentMon has no trace session, and no game ran; the adapters' happy paths are unverified on hardware.
- **Credential removal from the Sources page** is jsdom-tested only; the real `DELETE /api/credentials/:id` path never ran in a browser.
- **jpg/webp media artwork** is unverified; the live proof covered one PNG, and graceful helper shutdown on host exit is unit-tested only.
- **A source added while the editor is open** is not in the Reads picker until a reload (vg-713).
