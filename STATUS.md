# Yunari status

Updated: 2026-10-24
Branch: `main`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`archived plan`](docs/superpowers/plans/archive/2026-10-24-sensor-platform.md)) is delivered: seven phases from vocabulary/units/image binding through hardware, weather, media, custom sources, frame/game presence, and Steam store metadata. The text-elements and Wallpaper Engine plans are merged; no plan is in flight.

## Active work

- **All seven sensor-platform phases are complete**; the final gate after the Phase 7 review fixes ran green.
- **Phase 7 is proven end to end**: a real host and player, a fixture Steam store, the canonical name and cover painted, a cached reload with no request, and the cover fallback.
- **Every sensor-platform review finding is closed**: two whole-phase reviews, their scoped re-reviews, and the per-task fix rounds all returned clear.
- **Text elements are merged and unchanged by this merge**: `IText` and `Textbox` are separate classes, and the preset library holds palettes and gradients.
- **Open register findings include** vg-723 (every foreground process reads as a game), vg-724 (non-Steam identity), vg-717 (player descriptor catalogue), vg-699, vg-701 and vg-708.

## Last completed change

- **Register ids repaired after the merge:** the branch's vg-709–vg-716 findings collided with ids main already used, so they are now vg-718–vg-724.
- **vg-725 closes as verified:** the Steam store lookup answers the row that said store metadata was unused; the branch's stale vg-405 and vg-439 copies left the live file.
- **Citations follow the ids:** STATUS, ADR 0109, the spec and the archived plan now name vg-722/723/724/725.
- **Merged into `main`** with the run-display mode left to main's superseding commit and the sensor catalogue, descriptor seam and image sensor field kept.
- **Gate:** `npm run gate` exit 0 — web 382 test files / 5677 tests; store-worker 12 files / 72 tests; backlog-check 725 items valid.

## Next

1. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
2. Run a live adapter check with a game (RTSS or PresentMon) and a live Steam store lookup when the user can.
3. Choose the next objective from `docs/product/backlog.jsonl` (vg-723, vg-724 and vg-717 are the largest).

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only (vg-717); a source added while the editor is open needs a reload (vg-722).
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Presence still reads every foreground process as a game** (vg-723), so a store lookup can be asked about a browser once per spelling.
