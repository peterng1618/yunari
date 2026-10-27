# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

Two plans are complete — the type-token model and the display's own motion — and local `main` at `1d0b9b9` carries both; next is the backlog drain.

## Active work

- **No plan is running:** the type-token plan's six phases and the display-animation plan's seven tasks are done; `main` (at `b3a2b98`) is merged in here, and local `main` now points at this branch's tip.
- **The type-token model is in:** a token names a face whereas size, line height and tracking belong to each run (`0128`).
- **Display motion is in:** one fixed 30 fps `startSceneRefresh` loop, a transition pump in `YunariChart`, skip-unchanged bound text, and no chart-rate setting anywhere (`0129`).
- **The type-token final review is discharged:** its one blocking defect is fixed and re-reviewed FIXED (`a84f7d90`), and its should-fix is filed as `vg-772`.
- **Preview lens and display presentation landed:** scene-anchored box, letterbox, guide frame, circle lens, ratio catalogue, per-record shape and rotation.
- **The live line is placed by its data:** axis at its newest reading, no delay or hold, missing readings skipped, sample frames queued at the transport (0124).

## Last completed change

- **`main` (b3a2b98) is merged into this branch:** its 13 commits bring the display animation, and this file was the only conflict.
- **A new text now paints its role default before the first edit:** `addText` paints through the session's authoring-view port, so the canvas shows 16 (body at 1080) rather than Fabric's 40 for the whole first edit (`a84f7d90`).
- **Red-proved 40 → 16:** the paint is a no-op for objects with no authored runs and for a manager with no port installed.
- **The final review's should-fix is filed, not fixed:** a whole-family import binds one face, so save-cleanup offers the other declared weights and subsets for removal (`vg-772`).
- **Proof:** `npm run gate` exit 0 on the merged tree — 447 files / 6,885 passed + 1 skipped, browser 13 files / 130 passed.

## Next

1. Resume the backlog-drain plan at Phase 0, a reproduction pass over the register.
2. Verify the retargeted `editor.spec.ts` cases when preview port 4174 frees.
3. Owner test of a gauge mid-transition on a real display.

## Blockers / unverified

- **Browser arm unverified for both plans:** port 4174 is held by `background-media-becomes-a-layer`'s preview; nothing was killed and no port was moved.
- **The transition pump is unit-proven only:** no capture shows a gauge mid-transition on a real display.
- **The import flow has never run in a real browser on the type-token branch:** its chooser, dialog and Create steps match the dom test only.
- **Open rows:** `vg-770`, `vg-762`, `vg-771`, `vg-772`; starter role weights stay read-only while `Segoe UI` and `Consolas` are undeclared.
- **`vg-756` and the store-worker token handoff:** run specs via `node node_modules/@playwright/test/cli.js`, and closing `return-page.ts` needs a nonce or pinned-port decision.
