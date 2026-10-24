# Yunari status

Updated: 2026-10-25
Branch: `feat/game-identity`

## Current objective

**Game identity and the display catalogue is complete** ([`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), [`plan`](docs/superpowers/plans/archive/2026-10-24-game-identity-and-display-catalogue.md), [decision 0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md)): `game.running` means an identified game, and the player converts custom source units.

- **Plan state:** this plan completed and its file is archived; the next plan comes from `docs/superpowers/plans/`.

## Active work

- **Final review narrowed presence:** the uninstall source is gone and a Store package needs `MicrosoftGame.config`, so Edge, the terminal and the shell no longer read as games.
- **Final gate exit 0:** 406 files and 5861 tests passed, 1 skipped, no failure; `vg-726`'s SMTC helper was the last blocker and is fixed.
- **Windows-first boundary:** Linux catalogue readers and foreground detection are out of scope (spec D4) and owned by `vg-727`.
- **`vg-724` is open for art only:** naming for Steam, Epic, GOG, itch, Xbox and GDK Store packages landed; catalogue-matched non-Steam titles still report no artwork.
- **Known costs:** Steam is read twice per demand window, and a non-catalogue foreground costs one `readdir` per sample.
- **Store search is not a presence signal:** the Steam lookup stays demand-driven for name and artwork only.

## Last completed change

- **Final-review fix round** (`d0738c96`, `ff30c14d`): presence restricted to game-only sources, Epic honours an absolute launcher, a teardown/streak regression test and the ownership row; each fix red-proofed.
- **`vg-726` fixed** (`15978c51`): `GetSessions()` is projected into a PowerShell array, so an empty session list emits `none`; proved live with a playing Chromium session and after stopping it.
- **Register:** `vg-723` and `vg-717` verified, `vg-724` reopened for art, `vg-727` filed for Linux presence, `vg-726` verified.
- **Evidence:** `npm run gate` exit 0 (406 files / 5861 passed / 1 skipped); `docs:check`, `status:check`, `backlog:check` exit 0.

## Next

1. Work `vg-724`'s art half: local art for catalogue-matched non-Steam titles.
2. Work `vg-727`: a Linux foreground source plus the Linux catalogue readers and their fixtures.
3. Resume the backlog drain plan.

## Blockers / unverified

- **No live fullscreen game check**: window evidence is unit-tested with injected readings; the e2e uses a fixed foreground seam.
- **Epic, itch, Xbox and Store readers are fixture-tested only**: itch is absent on this PC, and the Store config probe ran only through injected seams.
- **GOG registry read costs one PowerShell process per demand window**; caching is designed but unmeasured.
- **No live Steam store request or frame reading**; both remain fixture-tested.
- **The player conversion red proof ran on pre-reflow spec bytes**; the same assertion failed, whitespace-only delta.
