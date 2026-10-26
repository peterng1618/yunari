# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

The preview-lens/stage work is merged; [`plan B`](docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md) (per-display shape and rotation, [`spec B`](docs/superpowers/specs/2026-10-26-display-rotation-design.md)) is the next plan, and the queued backlog drain follows it.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md` — task 1 (transform rotation and inscribed circle) is implemented; later tasks remain.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Display presentation in plan B:** per-record shape and rotation, rotated/inscribed playback, pair-page choice, Host controls.
- **Audit, chart, spacing and fonts work is on `main`:** revision gating, memoised dirty reading, chart animation and the fonts/assets rework are landed.
- **Backlog drain stays queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, after plan B.

## Last completed change

- **Task 1 of plan B:** `computeArtboardTransform` accepts `shape`/`rotation`, returns `rotation` and a 2×3 `matrix`; rotation 0 keeps today's fields exactly.
- **Refusals:** rect takes quarter turns only, circle whole degrees 0–359; fractions, negatives and non-finite angles throw `RangeError`; a circle reports `contentFit: "contain"`.
- **Evidence:** 50/50 artboard tests green; each new assertion shown red with its behaviour disabled; typecheck exit 0.
- **Decision note:** `docs/decisions/0124-a-display-carries-its-shape-and-the-transform-carries-a-matrix.md`.

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
