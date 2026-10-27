# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

The display animates on its own motion: the per-display chart rate setting goes
away and every chart's transition is blitted while it runs.

## Active work

- **No plan is running:** the display-animation plan is implemented, its spec closed out and its seven tasks recorded in the ledger; its plan stays in `docs/superpowers/plans/` until archived.
- **Backlog drain is next:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, starting at a reproduction pass over the register.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Display presentation landed:** per-record shape and rotation, rotated/inscribed playback, pair-page choice and Host controls.
- **The live line is placed by its data:** axis at its newest reading, no delay or hold, missing readings skipped, and sample frames queued at the transport (0124).

## Last completed change

- **The rate setting is gone end to end:** the host record, patch and poll, the player's follower and the editor's View menu and facade no longer carry a chart rate; one fixed 30 fps `startSceneRefresh` loop remains.
- **Motion is visible:** a chart's transition blits its own frames through the pump until `finished`, and bound text repaints only when its string changes (0128).
- **Preview coverage:** the fake source answers every `SEMANTIC_KEYS` entry with the kind its descriptor declares.
- **Proof:** `npm run gate` exit 0 — 437 test files / 6,730 passed + 1 skipped, worker 130; the two retargeted editor browser specs were not re-verified because another worktree owns preview port 4174.

## Next

1. Resume the backlog-drain plan at Phase 0, a reproduction pass over the register.
2. Archive the display-animation plan once nothing links it.
3. Verify the retargeted `editor.spec.ts` cases on a free preview port.
4. Owner test of a gauge mid-transition on a real display.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`; host-player's theme-chooser case is `vg-758`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **The transition pump is unit-proven, not browser-proven:** `chart-object.dom.test.ts` drives the engine's events by hand; no capture shows a gauge mid-transition on a real display.
- **No live GitHub Actions run and no real device:** `publish.yml`'s triggers, artifact hand-off and `npm ls` step are syntax-checked only, and no real phone, Linux or macOS host was exercised.
- **Playwright alpha shadows the runner (`vg-756`), preview port 4174 is held by another worktree, and the importer's save-wire residual is `vg-761`:** run specs through `node node_modules/@playwright/test/cli.js`, and keep a video under about 72 MiB until the save route's base64 bound is fixed.
