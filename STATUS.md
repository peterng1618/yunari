# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **Phases 1–5 are code complete** (Tasks 1.1–1.5, 2.1–2.4, 3.1–3.5, 4.1–4.3, 5.1–5.5); the Phase 5 gate is next.
- **Custom sources are proven end to end**: authored in Host mode, discovered by the inspector, rendered on a display, and explained when deleted.
- **Media is live end to end**: real Chrome session title/artist/state/position/duration, artwork bytes through the authed route, and `audio.volume`/`audio.muted` from the render endpoint.

## Last completed change

- **Task 5.5**: the Host mode's Sources section — list with health, last read, field count and redacted error; add/edit with the host's limits mirrored; refused saves in the route's own words; test with status, elapsed time and mapped values; a confirmed delete that offers the credential the route reports unreferenced.
- `SourcesClient` + `sources-section.tsx`; the page never renders a credential value or a key-bearing URL.
- **E2E** `tests/e2e/custom-source.spec.ts` (own host 4223, fixture 4291): the key appears in the Reads select, the player paints `42.5`, then after the page deletes the source it paints `—` with the host's "no provider on this PC reports that sensor" reason, and the theme still loads.
- **Evidence:** editor vitest 179 files / 2408 tests exit 0; `custom-source` e2e 1 passed; editor and host bundles rebuilt; editor typecheck and e2e tsconfig exit 0; biome clean.
- **Unverified:** the inspector's catalogue is read at editor boot, so a source added while the editor is open is visible after a reopen (the proven flow).

## Next

1. Run the Phase 5 gate.
2. Dispatch Phase 6 (frame and game presence) after the gate.
3. Review each task's diff and evidence before dispatching the next.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response** has run; both need user keys.
- **RTSS shared memory and PresentMon streaming** are unverified on this machine, including the privilege failure path.
- **Windows Geolocator permission behaviour** from a host-spawned PowerShell is unrun.
- **jpg/webp artwork** is unverified; the live proof covered one PNG.
- **Graceful host shutdown** stopping the media helper is unit-tested only; the live run ended with `taskkill /T`.
