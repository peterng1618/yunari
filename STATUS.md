# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **Phases 1–3 are complete** (Tasks 1.1–1.5, 2.1–2.4, 3.1–3.5); the Phase 3 gate ran green.
- **Phase 4 is next**: SMTC helper (4.1), media provider and artwork cache with `audio.volume`/`audio.muted` (4.2), media keys end to end (4.3).
- **Task 4.1 reuses the 0102 PowerShell supervisor**; decision 0103 fixes the script shape and rejects a native addon.

## Last completed change

- **Phase 3 complete** (Tasks 3.1–3.5): weather settings and manual place, Open-Meteo with WMO codes and vendored Meteocons, localized conditions, WeatherAPI/OpenWeatherMap BYOK, and the PowerShell supervisor with Windows location.
- **Gate:** `npm run gate` exit 0 — 353 test files / 5101 tests, worker 12 / 72.
- **Rulings 0099–0103:** provider owns its clock, language rides the player's ask, BYOK are two thin adapters, one supervisor for PowerShell, SMTC + CoreAudio in one script.
- **Reuse probe for media:** `node-nowplaying` rejected — 0.1.0, per-player volume, no `stopped` state (0103).

## Next

1. Dispatch Task 4.1 (SMTC helper) to a subagent.
2. Review each task's diff and evidence before dispatching the next.
3. Run the full gate at the end of each phase.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response** has run; both need user keys.
- **RTSS shared memory and PresentMon streaming** are unverified on this machine, including the privilege failure path.
- **Windows Geolocator permission behaviour** from a host-spawned PowerShell is unrun.
- **SMTC artwork bytes** were not read live (no playing app during the probe); the metadata half was (Chrome, paused).
- **Steam library-cache box-art naming** is unverified on this install.
