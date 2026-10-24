# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **Phases 1–5 are complete** (Tasks 1.1–1.5, 2.1–2.4, 3.1–3.5, 4.1–4.3, 5.1–5.5); the Phase 5 gate ran green.
- **Phase 6**: frame statistics (6.1, 6.2) and game presence (6.3) are complete; local box art (6.4) is next.
- **Custom sources are proven end to end**: authored in Host mode, discovered by the inspector, rendered on a display, and explained when deleted.
- **Media is live end to end**: real Chrome session title/artist/state/position/duration, artwork bytes through the authed route, and `audio.volume`/`audio.muted` from the render endpoint.

## Last completed change

- **Task 6.3**: foreground-process PowerShell helper plus a dependency-free KeyValues reader for `libraryfolders.vdf` and `appmanifest_*.acf`; the four `game.*` keys now answer.
- **Evidence:** 17 focused tests, host typecheck, biome and build all exit 0; the real library read 19 apps and the foreground probe emitted one JSON line per second.
- **Decision 0108** landed before the first provider write; the six rungs record the VDF/foreground package searches and the native-toolchain rejections.
- **Filed by the controller:** vg-714, every foreground process reads as a running game (the plan's presence rule, followed unchanged).

## Next

1. Dispatch Task 6.4 (local box art).
2. Review each task's diff and evidence before dispatching the next.
3. Run the full gate at the end of each phase.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response** has run; both need user keys, and **Windows Geolocator** from a host-spawned PowerShell is unrun.
- **Frame and game presence are unverified live:** RTSS is not running, PresentMon is not installed, and no game ran during Task 6.3 (Steam's 19 manifests and the foreground helper were probed).
- **Credential removal from the Sources page** is jsdom-tested only; the real `DELETE /api/credentials/:id` path never ran in a browser.
- **jpg/webp artwork** is unverified; the live proof covered one PNG, and graceful helper shutdown on host exit is unit-tested only.
- **A source added while the editor is open** is not in the Reads picker until a reload (vg-713).
