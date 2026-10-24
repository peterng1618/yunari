# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **All six phases are complete** (Tasks 1.1–6.4); the Phase 6 gate ran green.
- **The whole-branch review is complete**; its three must-fix and two should-fix items are implemented and red-proved, awaiting the boundary gate.
- **Custom sources are proven end to end**: authored in Host mode, discovered by the inspector, rendered on a display, and explained when deleted.
- **Media is live end to end**: real Chrome session title/artist/state/position/duration, artwork bytes through the authed route, and `audio.volume`/`audio.muted` from the render endpoint.

## Last completed change

- **Final-review fixes:** fan unit preference removed end to end; `weather.sunrise`/`sunset` render as instants; `cpu.cores.*` come from the library provider; an image binding to a non-image key is refused at validation.
- **Custom conversion:** a supplied descriptor's `unitKind` now drives a dynamic key's conversion, carried from the editor catalogue through the plan.
- **Spec:** fan removed from `UnitPreferences`, the units example, the auto-scale rule and Acceptance 3; a legacy `display.json` fan key is ignored.
- **Evidence:** focused suites renderer-core 24/406, host 53/822, editor 179/2412, scene-fabric 29/376; typechecks and host/editor builds green; every fix red-proved.

## Next

1. Run the full gate at the boundary and re-check the review's Must fix list.
2. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 is now used.
3. Run a live adapter check with a game (RTSS or PresentMon) when the user can start one.

## Blockers / unverified

- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only, because the player has no descriptor catalogue; a source added while the editor is open is not picked up until reload (vg-713).
- **No live WeatherAPI or OpenWeatherMap response**, no live Open-Meteo run and no Windows Geolocator run; fixtures and units are tested only.
- **No live frame or game reading:** RTSS is installed but not running, PresentMon has no trace session, and no game ran; the adapters' happy paths are unverified on hardware.
- **Credential removal from the Sources page** is jsdom-tested only; the real `DELETE /api/credentials/:id` path never ran in a browser.
- **jpg/webp media artwork** is unverified; the live proof covered one PNG, and graceful helper shutdown on host exit is unit-tested only.
