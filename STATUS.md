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

- **A family is drawn and applied by its lead face:** `leadCutOf` reads the cut id the result row carries, not `cuts[0]`, which for a Google family is often a non-Latin subset — the serif fallback Water Brush and Waterfall showed.
- **A cut's subset is named when weight and style repeat:** three 400 cuts read `400 · vietnamese`, `400 · latin-ext`, `400 · latin` instead of three identical `400` chips.
- **A face adopted mid-session is registered:** `watchDeclaredFontFaces` adds it to `document.fonts` and remeasures matching text; tiles are cards drawing a trio at 20 / 15 / 12 px.
- **A face is named by family and weight** wherever files are listed — Assets card, preview modal, background list, save cleanup — not by its packaged `google-fonts-cut-…` id.
- **Proof:** finder suite 10 files / 108 passed, `npm run typecheck` exit 0; real-glyph rendering of an adopted CDN face is still unverified here (the sandbox cannot reach the CDN).

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
