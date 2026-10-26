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

- **A family is drawn and applied by its lead face:** `leadCutOf` reads the cut id behind the row's `<source>:` prefix, not `cuts[0]` — the non-Latin subset that rendered as a serif.
- **A cut's subset is named when weight and style repeat** (`400 · latin`), and the chips use the panel's own face, not the specimen's.
- **An import brings the lead subset's weights:** Apply / Add as preset adopts every weight and style of the family's lead subset, and the Assets pane draws one card per family listing them; an already-declared face is never re-downloaded.
- **A bound preset's weight is a list of the faces the package holds,** not free text that would fall back to the browser font; an unbound preset keeps its editable family and weight.
- **Proof:** editor/document/assets suites pass, `npm run typecheck` exit 0; a browser run presses the latin cut, requests `latin-400` and `latin-700` (not `vietnamese`), and the bound preset's weight opens as a list of exactly `400` and `700`.

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
