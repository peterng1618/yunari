# Yunari status

Updated: 2026-10-25
Branch: `feat/game-identity`

## Current objective

**Game identity and the display catalogue is complete** ([`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), [`plan`](docs/superpowers/plans/2026-10-24-game-identity-and-display-catalogue.md), [decision 0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md)): `game.running` means an identified game, and the player converts custom source units.

## Active work

- **The plan is finished**: Phases 1–5.1 are committed; this close-out closes vg-723, vg-724 and vg-717 and files vg-727 for Linux presence.
- **Final code gate**: `GATE_EXIT=1` with only the 2 pre-existing SMTC tests (vg-726) plus two ThemeStore asset-bounds cases that pass alone (69/69); 5789/5793 passed.
- **Windows-first boundary**: Linux catalogue readers and foreground detection are out of scope (spec D4) and now owned by vg-727.
- **Known costs**: the provider reads Steam twice per demand window, and a non-catalogue foreground costs one readdir per sample.
- **Store search is not a presence signal**: the Steam lookup stays demand-driven for name and artwork only.

## Last completed change

- **Task 5.2** (base `d703fbcb`): closed vg-723, vg-724 and vg-717 as `verified` with checks and artefact shas, and filed vg-727 for Linux presence.
- **Artefacts**: vg-723 `801fe2b5`, vg-724 `fc0077b4`, vg-717 `55c9c470`; each verified as an ancestor of HEAD.
- **Evidence**: `npm run backlog:check` exit 0 (727 items across both registers); `npm run status:check` exit 0.

## Next

1. Fix vg-726: project `GetSessions()` into a PowerShell collection so the empty SMTC case emits `none`.
2. Work vg-727: a Linux foreground source plus the Linux catalogue readers and their fixtures.
3. Resume the backlog drain plan.

## Blockers / unverified

- **No live game check**: the classifier's window evidence needs a real fullscreen game; the e2e uses a fixed foreground seam.
- **Epic, itch and Xbox formats are fixture-tested only**: the readers never ran against a real store here, and itch is absent on this PC.
- **GOG registry read costs one PowerShell process per demand window**; caching is designed but unmeasured.
- **No live Steam store request or frame reading**; both remain fixture-tested.
