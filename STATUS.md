# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/improve-charts` (worktree `improve-charts`)

## Current objective

Two plans are complete — the type-token model and the display's own motion — and this tree carries both; next is the backlog drain, with the browser arm still unverified.

## Active work

- **No plan is running:** the type-token plan's six phases and the display-animation plan's seven tasks are done; `main` is merged in here and this branch merges back next.
- **The type-token model is in:** a token names a face whereas size, line height and tracking belong to each run (`0128`).
- **Display motion is in:** one fixed 30 fps `startSceneRefresh` loop, a transition pump in `YunariChart`, skip-unchanged bound text, and no chart-rate setting anywhere (`0129`).
- **Preview lens and display presentation landed:** scene-anchored box, letterbox, guide frame, circle lens, ratio catalogue, per-record shape and rotation.
- **The live line is placed by its data:** axis at its newest reading, no delay or hold, missing readings skipped, sample frames queued at the transport (0124).

## Last completed change

- **`main` is merged into this branch:** the type-token work arrives whole; the only conflict was this file, and our decision note is renumbered `0129` because main already owns `0128`.
- **`STATUS.md` states both plans' current truth:** type-token done, display animation done and merged here, backlog drain next.
- **Both plans' gate evidence is kept:** type-token `npm run gate` exit 0 at `79d5140b` (447 files / 6,890 passed); display animation exit 0 (437 files / 6,730 passed).
- **Proof:** `npm run typecheck --workspaces`, `npm run status:check` and the display-animation suites re-run after the merge.

## Next

1. Merge this tree back to local `main` so the user can test both.
2. Resume the backlog-drain plan at Phase 0, a reproduction pass over the register.
3. Verify the retargeted `editor.spec.ts` cases when preview port 4174 frees.
4. Owner test of a gauge mid-transition on a real display.

## Blockers / unverified

- **Browser arm unverified for both plans:** port 4174 is held by `background-media-becomes-a-layer`'s preview; nothing was killed and no port was moved.
- **The transition pump is unit-proven only:** no capture shows a gauge mid-transition on a real display.
- **The import flow has never run in a real browser on the type-token branch:** its chooser, dialog and Create steps match the dom test only.
- **Open rows:** `vg-770`, `vg-762`, `vg-771`; starter role weights stay read-only while `Segoe UI` and `Consolas` are undeclared.
- **`vg-756` and the store-worker token handoff:** run specs via `node node_modules/@playwright/test/cli.js`, and closing `return-page.ts` needs a nonce or pinned-port decision.
