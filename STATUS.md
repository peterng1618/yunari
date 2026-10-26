# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

Execute [`the Wallpaper Engine import rework`](docs/superpowers/plans/2026-10-26-wallpaper-engine-import-rework.md) with subagent-driven development: remove UI automation, convert scenes to local projects, import `.mpkg`/video through a modal, and draw the library as cards.

## Active work

- **All eight tasks are complete:** docs record the shipped route and the capture is refreshed; the plan awaits a local merge to `main`.
- **One plan runs:** the import rework remains active in its Orca worktree until that merge; plan B is queued behind it.
- **Plan B waits:** per-display shape and rotation stays queued.
- **Backlog drain stays queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, after plan B.

## Last completed change

- **Gaps:** spec §11's row names both shapes, and a scene dropped before listing is counted in the library's `skipped` total rather than named in the editor.
- **Proof:** `docs:check` and `status:check` pass from this commit.

## Next

1. Locally merge the import rework to `main`.
2. Execute plan B after that merge.
3. Resume the backlog-drain plan at Phase 0.
4. Owner tests remain: segment spacing and fill, radar and polar bar, scene export, fonts and assets rework.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **No live GitHub Actions run and no real device:** `publish.yml`'s triggers, artifact hand-off and `npm ls` step are syntax-checked only, and no real phone, Linux or macOS host was exercised (PWA, keyring and ffmpeg pairs are read or mocked rather than measured).
- **Playwright alpha shadows the test runner:** `@playwright/mcp` hoists `playwright@1.64.0-alpha`, shadowing `@playwright/test@1.63.0`; run specs through `node node_modules/@playwright/test/cli.js`.
- **Plan A's deferrals are filed:** `vg-746`–`vg-751` in `docs/product/backlog.jsonl`.
