# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **Phases 1–5 are complete** (Tasks 1.1–1.5, 2.1–2.4, 3.1–3.5, 4.1–4.3, 5.1–5.5); the Phase 5 gate ran green.
- **Phase 6 is next**: frame statistics (6.1, 6.2) and game presence with local box art (6.3, 6.4).
- **Custom sources are proven end to end**: authored in Host mode, discovered by the inspector, rendered on a display, and explained when deleted.
- **Media is live end to end**: real Chrome session title/artist/state/position/duration, artwork bytes through the authed route, and `audio.volume`/`audio.muted` from the render endpoint.

## Last completed change

- **Task 5.5**: the Host mode's Sources section — list, add/edit with the id fixed and unshown field properties preserved, a write-free test, and a delete that offers the unreferenced credential.
- **Phase 5 gate:** `npm run gate` exit 0 — web 362 files / 5305 tests, store-worker 12 files / 72 tests.
- **E2E** `tests/e2e/custom-source.spec.ts` (own host 4225, fixture 4291): the key appears in the Reads select, the player paints `42.5`, then after deletion `—` with the host's "no provider on this PC reports that sensor", and the theme still loads.
- **Filed:** vg-713 (a source added while the editor is open needs a reload before its key appears).

## Next

1. Dispatch Task 6.1 (frame window and the RTSS adapter).
2. Review each task's diff and evidence before dispatching the next.
3. Run the full gate at the end of each phase.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response** has run; both need user keys, and **Windows Geolocator** from a host-spawned PowerShell is unrun.
- **Phase 6 is unverified live:** RTSS is installed but not running, PresentMon is not installed, and Steam's `librarycache` is absent (19 app manifests exist).
- **Credential removal from the Sources page** is jsdom-tested only; the real `DELETE /api/credentials/:id` path never ran in a browser.
- **jpg/webp artwork** is unverified; the live proof covered one PNG, and graceful helper shutdown on host exit is unit-tested only.
- **A source added while the editor is open** is not in the Reads picker until a reload (vg-713).
