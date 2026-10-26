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

- **Author:** spec §7.3 drops the "needs a Steam API key" claim; the shipped lookup writes the persona name when it resolves, and failure is absence.
- **Export:** spec §14 and §11 now say the author exports a converted project to `.mpkg`, and `.mpkg`/video files enter through the modal.
- **Tokens:** the import modal is named as shared with the Assets pane, not a second Wallpaper Engine dialog.
- **Proof:** `docs:check` and `status:check` pass from this commit.

## Next

1. Locally merge the import rework to `main`.
2. Execute plan B after that merge.
3. Resume the backlog-drain plan at Phase 0.
4. Owner tests remain: segment spacing and fill, radar and polar bar, scene export, fonts and assets rework.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
- **Plan A's deferrals are filed:** `vg-746`–`vg-751` in `docs/product/backlog.jsonl`.
