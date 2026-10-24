# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`archived plan`](docs/superpowers/plans/archive/2026-10-24-sensor-platform.md)) is delivered: seven phases from vocabulary/units/image binding through hardware, weather, media, custom sources, frame/game presence, and Steam store metadata.

- **Plans:** none in flight — the sensor-platform plan is complete and archived.

## Active work

- **All seven phases are complete**; the final gate after the Phase 7 review fixes ran green.
- **Phase 7 is proven end to end**: a real host and player, a fixture Steam store, the canonical name and cover painted, a cached reload with no request, and the cover fallback.
- **Every review finding is closed**: two whole-phase reviews, their scoped re-reviews, and the per-task fix rounds all returned clear.
- **Media and custom sources remain proven** with the live evidence recorded at Phase 6.

## Last completed change

- **Final gate:** `npm run gate` exit 0 — web 371 test files / 5473 tests; store-worker 12 files / 72 tests.
- **Review fixes:** lookup reports match/none/unavailable with distinct copy; a cached miss answers only its own spelling; covers over 5 MiB are refused and cached files validated; concurrent cover demands share one download.
- **Docs truth:** the spec states what the store cache keeps (normalised name, searched term, canonical name, first-lookup time, cover bytes) and the per-spelling request budget; the plan is archived.
- **Evidence:** `game-metadata` e2e 1 passed in 11.5 s; host build, typechecks, Biome and the docs/status checks exit 0.

## Next

1. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
2. Run a live adapter check with a game (RTSS or PresentMon) and a live Steam store lookup when the user can.
3. Choose the next objective from `docs/product/backlog.jsonl` (vg-714, vg-715, vg-717 are the largest).

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only (vg-717); a source added while the editor is open needs a reload (vg-713).
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Presence still reads every foreground process as a game** (vg-714), so a store lookup can be asked about a browser once per spelling.
