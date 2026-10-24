# Yunari status

Updated: 2026-10-24
Branch: `feat/game-identity`

## Current objective

**Game identity and the display catalogue** ([`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), [`plan`](docs/superpowers/plans/2026-10-24-game-identity-and-display-catalogue.md), [decision 0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md)): `game.running` means an identified game, not any foreground window, and the player converts custom source units.

- **Active plan:** `docs/superpowers/plans/2026-10-24-game-identity-and-display-catalogue.md`

## Active work

- **Phase 3 (shared descriptor mapping)**: Tasks 3.1 and 3.2 done; **the phase gate and the player catalogue's e2e are next**.
- **Phase 2 (classifier)** replaces `game.running`'s pid check with catalogue, runtime-marker and window evidence, debounced.
- **Phase 4 (player catalogue)** moves the wire mapping to `renderer-core` and passes descriptors to `refreshBoundText`.
- **Windows-first**: Linux catalogue readers and foreground detection stay out, recorded in the spec.
- **Store search is not a presence signal**: the Steam lookup stays demand-driven for name and artwork only.

## Last completed change

- **Task 3.2** (`5a870e86`): editor `sensor-catalogue.ts` calls `descriptorsFromWire`; its local wire mapper is deleted, fetch and failure behaviour unchanged.
- **Equality test** runs one wire array (a custom key plus a built-in collision) through the catalogue and through `descriptorsFromWire`; built-ins-survive tests kept.
- **Evidence:** editor catalogue 5/5 and chart picker 23/23 exit 0; `typecheck -w @yunari/editor` and Biome exit 0; full gate not run (Phase 3 gate follows).

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
