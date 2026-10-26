# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

The preview-lens/stage work is merged; [`plan B`](docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md) (per-display shape and rotation, [`spec B`](docs/superpowers/specs/2026-10-26-display-rotation-design.md)) is the next plan, and the queued backlog drain follows it.

## Active work

- **No plan is running:** plan A is merged; plan B is queued and no other plan runs.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Display presentation waits on plan B:** per-record shape and rotation, rotated/inscribed playback, pair-page choice, Host controls.
- **Audit, chart, spacing and fonts work is on `main`:** revision gating, memoised dirty reading, chart animation and the fonts/assets rework are landed.
- **Backlog drain stays queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, after plan B.

## Last completed change

- **Plan A merged into `main`:** 26 commits; the display is a scene-anchored lens frame painted by the shell stage over the theme's own letterbox.
- **One catalogue in both pickers:** the display menu and the new-document chooser list the active ratios by id, with Fit alone when the list is empty.
- **Browser proof:** stage texture, letterbox layer order, guide geometry through zoom/pan/Fit, circle clipping and media remounts.
- **Merge conflicts:** `STATUS.md` and the backlog register only; the preview-lens ADR was renumbered to 0123 because three notes already held 0119.
- **Gate on the merged tree:** `npm run gate` exit 0 — 434 files / 6658 passed, 2 skipped; Worker 13 / 130.

## Next

1. Execute plan B with subagent-driven development; local merge to `main` on completion.
2. Resume the backlog-drain plan at Phase 0 after that merge.
3. Triage the pre-existing browser reds recorded below.
4. Owner tests remain: segment spacing and fill, radar and polar bar, scene export, fonts and assets rework.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
- **Plan A's deferrals are filed:** `vg-746`–`vg-751` in `docs/product/backlog.jsonl`.
