# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

The 2026-10-25 performance and security audit is closed and `main` is merged into its branch; the chart, segment-spacing and fonts work waits on the owner's tests, and the next objective is the queued backlog drain.

## Active work

- **No plan is running:** the hardening plan is closed and archived; the chart, spacing and fonts plans are landed, and the queue resumes at the backlog-drain plan.
- **Nothing was filed:** the ruling held — every audit finding and everything found while implementing it was fixed inside the plan.
- **The merge preserves both designs:** main's chart animation, reading signature and chart rate drive the player, and the audit's revision gating and memoised dirty reading sit inside them.

## Last completed change

- **`origin/main` is merged into the audit branch and back into `main`:** thirteen conflicts resolved, with main's animation, spacing, fonts and asset work kept alongside the audit's fixes.
- **The gate is green on the merged tree:** biome 1098 files; 434 files / 6601 passed, 1 skipped; Worker 13 / 130.
- **The player repaints per chart reading,** so an engine transition finishes instead of restarting every frame, while bound text, images and the notice still wait for a sample.
- **The editor's dirty answer is one reading per change,** bumped synchronously so a read straight after a change is never stale, with the listener flush still coalesced into one microtask.
- **`woff`, `ttf` and `otf` are declarable again:** the shared media-type table and the editor's extension policy carry what the theme format and the schema admit.

## Next

1. Start the backlog-drain plan with a reproduction pass, not a fix pass.
2. Owner test of segment spacing and fill mode: drag 1–100 and toggle the gauge and bar fill.
3. Owner test of radar and polar bar, then phone performance and value-chart transition evidence.
4. Owner test of one scene export end to end, and of the fonts and assets rework.
5. Triage the pre-existing browser reds recorded below.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`.
- **Owner tests pending:** the spacing checkpoint, radar and polar bar, the engine's Save click and folder fallback, the scene export, and the fonts and assets rework are unverified live.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — pre-existing, and closing it needs a nonce or pinned-port binding, so it is a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
