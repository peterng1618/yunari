# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/improve-charts`

## Current objective

Place the live line on its data clock — axis at its newest reading, no delay or hold, missing readings skipped — and queue sample frames at the transport (0124).

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-the-live-line-is-placed-by-its-data.md`
- **Plan B waits:** display presentation is queued and does not run beside this plan.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Display presentation waits on plan B:** per-record shape and rotation, rotated/inscribed playback, pair-page choice, Host controls.
- **Backlog drain stays queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, after plan B.

## Last completed change

- **The live line is placed by its data:** the axis ends at the newest plottable reading and missing readings are skipped, so the same samples draw the same option whatever `Date.now()` says (0124).
- **The transport keeps every batch:** `SseConnection` drains a bounded 120-frame queue on `drain` instead of holding only the newest pending frame.
- **The delay is gone:** `liveTail`, `chartPlaybackDelayFor`, `chartPlaybackDelayMs` and the editor/player arguments are deleted.
- **Measured at 1 fps:** the per-frame probe read 25,975 frames over 80 s on three line charts — 0 axis/newest mismatches, 0 nulls, 0 backwards steps.
- **Gate:** `npm run gate` exit 0 — 434 unit files / 6,659 tests and 13 worker files / 130 tests passed.

## Next

1. Merge locally to `main`; then plan B.
2. Measure the 30 fps browser arm — `this-pc` is pinned to 1 fps and a fabricated record's stream stalled.
3. Resume the backlog-drain plan at Phase 0 after that merge.
4. Triage the pre-existing browser reds recorded below.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **The 30 fps browser arm is unmeasured:** `this-pc` is 1 fps by kind and cannot hold a rate; only the unit cadence case covers rate-independence.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
