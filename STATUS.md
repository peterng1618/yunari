# Yunari status

Updated: 2026-10-26
Branch: `peterng1618/background-media-becomes-a-layer`

## Current objective

Land the preview-lens/stage and per-display shape/rotation work: [`spec A`](docs/superpowers/specs/2026-10-26-preview-lens-and-stage-design.md) → [`plan A`](docs/superpowers/plans/2026-10-26-preview-lens-and-stage.md), then [`spec B`](docs/superpowers/specs/2026-10-26-display-rotation-design.md) → [`plan B`](docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md).

## Active work

- **Active plan:** `2026-10-26-preview-lens-and-stage`; plan B is queued behind it, and no other plan runs.
- **Preview lens:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and settings tab.
- **Display presentation:** per-record shape and rotation, rotated/inscribed playback, pair-page choice, Host controls.
- **Backlog drain stays queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, 259 rows open.

## Last completed change

- **Stage and letterbox split:** the stage paints the palette texture over `--stage`; the display screen carries the theme's artboard paint and its circle radius.
- **Guide frame:** dashed `[data-yunari-theme-guide]` tracks `artboardScreenRect()`, hidden under Fit or when lens and board aspects match.
- **Media follows the display box:** display-bounded media takes the display box and circular clip, falling back to the artboard before host layout.
- **Verified:** focused DOM 86/86 and 450/450; biome and design-tokens exit 0; typecheck still red only in Task 4–5 surfaces.
- **Browser proof owed:** Task 5 owns Playwright for stacking, letterbox colour, guide motion and circle radius.

## Next

1. Execute plan A with subagent-driven development; local merge to `main` on completion.
2. Execute plan B the same way; local merge to `main` on completion.
3. Resume the backlog-drain plan at Phase 0 after both merges.
4. Live tray run and the staged Linux tray binary remain the owner's checks.

## Blockers / unverified

- **Publish is unverified end to end:** no workflow dispatch, trusted-publisher run or first publish.
- **No real N−1 migration is exercised:** the dispatcher is a forward obligation.
- **No live fullscreen game check:** evidence is unit-tested through injected readings.
- **Epic, itch, Xbox and Store readers are fixture-tested only.**
- **Two dependency deviations remain:** `ffmpeg-static` playback unexercised; `npm ls` marks overridden edges `invalid`.
