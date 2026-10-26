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

- **Previews settings tab:** a fifth tab between Appearance and Keyboard lists one row per stored ratio with its derived lens ids and a Remove control whose name includes them.
- **Add and refuse:** Rect/Circle shape, a `W:H` field for Rect that refuses a typed `Circle`, GCD-normalised ids, duplicates checked by derived lens count; every refusal is a `role="alert"` from `uiCopy`.
- **Reset and session:** reset deletes the stored key and sets the defaults explicitly, disabled at defaults; a browser with no store keeps the list for the session.
- **Boot load:** `createShellLayout` reads `yunari.editor.preview-ratios` once before any editor mounts, proven by boot tests for a stored list, an absent key and a reset reload; ADR-0119 records that sentence.
- **Verified:** focused settings DOM 37/37, related catalogue/shell files 119/119, biome exit 0; typecheck still red only in Task 5 menu/chooser surfaces.

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
