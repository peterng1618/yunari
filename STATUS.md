# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

The live line is on its data clock; the queued backlog drain is next, starting
at a reproduction pass over the register.

## Active work

- **No plan is running:** plan A, plan B, the live line's data clock and the Wallpaper Engine import rework are merged into `main`; their specs are landed and their plans archived.
- **Backlog drain is next:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, starting at a reproduction pass over the register.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Display presentation landed:** per-record shape and rotation, rotated/inscribed playback, pair-page choice and Host controls.
- **The live line is placed by its data:** axis at its newest reading, no delay or hold, missing readings skipped, and sample frames queued at the transport (0124).

## Last completed change

- **Smoothing is authored again:** line `interpolation` is `linear | step | smooth`, the field offers Smooth, and the validator accepts it while still refusing unknown values (0127).
- **The line still does not animate:** `chartAnimationFor` keeps the line at `animate: false`, so the chart has one kind of motion and the curve only reshapes when a sample lands.
- **Proof:** 4 tests failed first; 188 pass in the three touched suites, 896 across renderer-core and chart-object, 47 in the editor field tests; typecheck, biome, reuse gate and docs check exit 0.
- **Unverified:** no browser capture of the curved line.

## Next

1. Resume the backlog-drain plan at Phase 0, a reproduction pass over the register.
2. Measure the 30 fps browser arm — `this-pc` is pinned to 1 fps and a fabricated record's stream stalled.
3. Owner test of the live line's right edge, in the editor and on a phone, with machine sensors.
4. Triage the pre-existing browser reds recorded below.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`; host-player's theme-chooser case is `vg-758`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **The 30 fps browser arm is unmeasured:** `this-pc` is 1 fps by kind and cannot hold a rate; only the unit cadence case covers rate-independence.
- **No live GitHub Actions run and no real device:** `publish.yml`'s triggers, artifact hand-off and `npm ls` step are syntax-checked only, and no real phone, Linux or macOS host was exercised.
- **Playwright alpha shadows the runner (`vg-756`) and the importer's save-wire residual is `vg-761`:** run specs through `node node_modules/@playwright/test/cli.js`, and keep a video under about 72 MiB until the save route's base64 bound is fixed.
