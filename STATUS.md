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

- **Phase 1 complete** (`eaf16238`, Steam gap fixed in `fc0077b4`): catalogue split into `catalogue/` per-source modules plus aggregation; 159 `providers/game` tests pass, host typecheck exit 0.
- **Sources reachable in production:** Steam adapter is the default seam; Epic, GOG, itch, Xbox, Microsoft Store Appx and uninstall entries are read by type; no network.
- **Phase gate caveat:** `npm run gate` exit 1 only on two live SMTC tests (`smtc-helper.windows.test.ts`), reproduced identically on `main`; filed as vg-726.
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
