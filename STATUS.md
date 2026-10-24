# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: seven phases from vocabulary/units/image binding through hardware, weather, media, custom sources, frame/game presence, and Steam store metadata.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **All six executed phases are complete** (Tasks 1.1–6.4); Phase 7 (Steam store metadata) is specified and planned, not started.
- **The whole-branch review's five findings are fixed**, and the scoped re-review of commit 6fb7ff29 returned ALL CLEAR with no must-fix.
- **The boundary gate after the fixes ran green**: web 369 test files / 5402 tests, store-worker 12 files / 72 tests.
- **Custom sources and media remain proven end to end** (live e2e and real Chrome/SMTC session, as before).

## Last completed change

- **Final-review fixes:** fan unit preference removed end to end; `weather.sunrise`/`sunset` render as instants; `cpu.cores.*` come from the library provider.
- **Contract fixes:** an image binding to a non-image key is refused at validation; a supplied descriptor's `unitKind` drives a dynamic key's conversion.
- **Phase 7 written:** spec section and plan Tasks 7.1–7.5 for a keyless Steam store lookup on by default, a two-tier matcher, a per-game cache and covers through the gated route.
- **Record:** decision 0109 covers the reuse gate; vg-717 files the player's missing descriptor catalogue.
- **Evidence:** focused suites plus the boundary gate green; five red-proofs, each restored with `cp` + `cmp`.

## Next

1. Execute Phase 7 Tasks 7.1–7.5 through subagents, one task and one review at a time.
2. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
3. Run a live adapter check with a game (RTSS or PresentMon) when the user can start one.

## Blockers / unverified

- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only (vg-717); a source added while the editor is open needs a reload (vg-713).
- **No live WeatherAPI or OpenWeatherMap response**, no live Open-Meteo run and no Windows Geolocator run; fixtures and units are tested only.
- **No live frame or game reading:** RTSS is installed but not running, PresentMon has no trace session, and no game ran.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Phase 7's store lookup is not implemented yet**, so no live Steam store request exists; the endpoint probes were run by hand.
