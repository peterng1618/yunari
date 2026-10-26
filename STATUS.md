# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

Execute [`the Wallpaper Engine import rework`](docs/superpowers/plans/2026-10-26-wallpaper-engine-import-rework.md) with subagent-driven development: remove UI automation, convert scenes to local projects, import `.mpkg`/video through a modal, and draw the library as cards.

## Active work

- **One plan runs:** the import rework is active in its Orca worktree; plan B is queued behind it, and no other plan runs.
- **Plan shape:** eight tasks — host removal and routes, editor client, import modal, card grid, credits, skeletons, docs and gate.
- **Plan B waits:** per-display shape and rotation stays queued.
- **Backlog drain stays queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, after plan B.

## Last completed change

- **Fonts draw in the session that adopts them:** a face adopted from the finder or imported from disk is registered in `document.fonts` and matching text is remeasured, instead of falling back to a serif until the theme is reopened.
- **The font finder's tiles are cards:** a specimen box drawing a trio's three faces at heading/body/mono sizes (a family draws its first cut), the result's name, metadata and source mark.
- **A face is named by family and weight** wherever files are listed — Assets card, preview modal, background list, save cleanup — not by its packaged `google-fonts-cut-…` id.
- **Browser proof:** cards render three specimen rows at 20 / 15 / 12 px in the result's own families, and applying a trio mid-session leaves three `loaded` FontFaces (`Inter:700`, `Poppins:400`, `Fira Code:400`) in `document.fonts`.
- **Gate and merge:** `npm run gate` exit 0 — 435 files / 6663 passed, 2 skipped; worker 13 / 130. Both commits merged locally into `main` (`9e3871c7`, `c41ecdb7`); nothing is pushed.

## Next

1. Execute the import-rework plan task by task; local merge to `main` on completion.
2. Execute plan B after that merge.
3. Resume the backlog-drain plan at Phase 0.
4. Owner tests remain: segment spacing and fill, radar and polar bar, scene export, fonts and assets rework.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
- **Plan A's deferrals are filed:** `vg-746`–`vg-751` in `docs/product/backlog.jsonl`.
