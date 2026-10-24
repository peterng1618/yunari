# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **Phases 1–4 are complete** (Tasks 1.1–1.5, 2.1–2.4, 3.1–3.5, 4.1–4.3); the Phase 4 gate ran green.
- **Phase 5 is next**: `sources.json` store and validation (5.1), fetch client with SSRF rules and JSON Pointer (5.2), custom source provider (5.3).
- **Media is live end to end**: real Chrome session title/artist/state/position/duration, artwork bytes through the authed route, and `audio.volume`/`audio.muted` from the render endpoint.

## Last completed change

- **Phase 4 complete** (Tasks 4.1–4.3): SMTC helper over the 0102 supervisor, media provider with a content-addressed artwork cache and authed route, CoreAudio volume/mute, and a browser proof of text + artwork rendering.
- **Gate:** `npm run gate` exit 0 — 356 test files / 5162 tests, worker 12 / 72.
- **Rulings 0103**: one PowerShell script for SMTC + CoreAudio; `media.app` is the registry display name else the AUMID; artwork rides a helper restart on demand.
- **Filed, not fixed:** vg-709 (two sessions of one app collapse), vg-710 (a dead artwork path reports `missing`, not `unavailable`).

## Next

1. Dispatch Task 5.1 (`sources.json` store and validation).
2. Review each task's diff and evidence before dispatching the next.
3. Run the full gate at the end of each phase.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response** has run; both need user keys.
- **RTSS shared memory and PresentMon streaming** are unverified on this machine, including the privilege failure path.
- **Windows Geolocator permission behaviour** from a host-spawned PowerShell is unrun.
- **jpg/webp artwork** is unverified; the live proof covered one PNG.
- **Graceful host shutdown** stopping the media helper is unit-tested only; the live run ended with `taskkill /T`.
