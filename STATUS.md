# Yunari status

Updated: 2026-10-24
Branch: `feat/game-identity`

## Current objective

**Game identity and the display catalogue** ([`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), [`plan`](docs/superpowers/plans/2026-10-24-game-identity-and-display-catalogue.md), [decision 0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md)): `game.running` means an identified game, not any foreground window, and the player converts custom source units.

- **Active plan:** `docs/superpowers/plans/2026-10-24-game-identity-and-display-catalogue.md`

## Active work

- **Phase 2 (classifier) is next**: helper reports window class and fullscreen, resolves the UWP frame-host child, then presence stops reading any foreground window as a game.
- **Phase 2 (classifier)** replaces `game.running`'s pid check with catalogue, runtime-marker and window evidence, debounced.
- **Phase 4 (player catalogue)** moves the wire mapping to `renderer-core` and passes descriptors to `refreshBoundText`.
- **Windows-first**: Linux catalogue readers and foreground detection stay out, recorded in the spec.
- **Store search is not a presence signal**: the Steam lookup stays demand-driven for name and artwork only.

## Last completed change

- **Task 2.1 landed** (`424812dd`, proof `f3ad3b37`): helper reports `class`, `fullscreen`, `d3dFullscreen` and resolves the UWP `CoreWindow` child; 31 helper tests pass.
- **Live proof:** the helper emitted a real line (`Chrome_WidgetWin_1`, both booleans false), and the reviewer exercised the frame-host branch with Calculator (`Windows.UI.Core.CoreWindow`, `CalculatorApp.exe`).
- **Unproven live:** `fullscreen:true` and `d3dFullscreen:true`; their constants and comparisons are reviewed but never observed.
- **Task 2.2 (classifier) is running**, then presence switches to it.
- **No tray icon exists**: host lifetime remains terminal-owned (`host/src/main.ts`), and this plan does not add one.

## Next

1. Execute Phase 1, then Phase 2, 3 and 4 through the subagent loop; gate at each phase end.
2. Close vg-723, vg-724 (Windows half) and vg-717 with checks and artefact shas; file the Linux presence gap separately.
3. Raise the stale AGENTS.md Playwright port range (4215–4237) with the user; 4239 and 4245 are now used.

## Blockers / unverified

- **No live game check yet**: the classifier's window evidence needs a real fullscreen game; the e2e uses a fixed foreground seam.
- **Epic, itch and Xbox formats are undocumented**: readers are fixture-tested only, and itch is absent on this PC.
- **GOG registry read costs one PowerShell process per demand window**; caching is designed but unmeasured.
- **Linux presence has no owner**: no foreground source exists outside Windows.
- **No live Steam store request or live frame reading**; both remain fixture-tested.
