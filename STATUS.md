# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

Stop the live line's right edge revising a stretch it has already painted, the owner's report from 2026-10-27; plan B and the backlog drain stay queued behind it.

## Active work

- **No plan is running:** plan A is merged; plan B is queued and no other plan runs.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Display presentation waits on plan B:** per-record shape and rotation, rotated/inscribed playback, pair-page choice, Host controls.
- **Audit, chart, spacing and fonts work is on `main`:** revision gating, memoised dirty reading, chart animation and the fonts/assets rework are landed.
- **Backlog drain stays queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, after plan B.

## Last completed change

- **A stall's step survives the batches that follow it:** `liveTail` derives the hold and step from every sample gap instead of the newest pair, so the next batch no longer slopes a flat stretch already painted.
- **The live line no longer corrects at the edge:** the per-frame probe read 15 revisions per line chart before the change and 0 after, on the editor's real machine sensors.
- **Red first:** the drawn-value case across the batch after a stall and three `liveTail` expectations failed before the change; the chart suite is 324/324 after it, typecheck exit 0.
- **Main's font and token work is merged:** lead-subset import, one family card per face set, and a bound preset's weight chosen from the package's faces.

## Next

1. Owner test of the live line's right edge, in the editor and on a phone, with machine sensors.
2. Decide whether the 2 s delay should follow the received cadence: the editor receives a batch every ~2 s because the host drops every other one under backpressure (`vg-753`).
3. Execute plan B with subagent-driven development; local merge to `main` on completion.
4. Resume the backlog-drain plan at Phase 0 after that merge.
5. Triage the pre-existing browser reds recorded below.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
- **Plan A's deferrals are filed:** `vg-746`–`vg-751` in `docs/product/backlog.jsonl`.
