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

- **Fonts draw in the session that adopts them:** a face adopted from the finder or imported from disk is registered in `document.fonts` and matching text is remeasured, instead of falling back to a serif until the theme is reopened.
- **The font finder's tiles are cards:** a specimen box drawing a trio's three faces at heading/body/mono sizes (a family draws its first cut), the result's name, metadata and source mark.
- **A face is named by family and weight** wherever files are listed — Assets card, preview modal, background list, save cleanup — not by its packaged `google-fonts-cut-…` id.
- **Browser proof:** cards render three specimen rows at 20 / 15 / 12 px in the result's own families, and applying a trio mid-session leaves three `loaded` FontFaces (`Inter:700`, `Poppins:400`, `Fira Code:400`) in `document.fonts`.
- **Gate and merge:** `npm run gate` exit 0 — 435 files / 6663 passed, 2 skipped; worker 13 / 130. Both commits merged locally into `main` (`9e3871c7`, `c41ecdb7`); nothing is pushed.

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
