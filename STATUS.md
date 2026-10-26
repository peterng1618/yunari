# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

The preview-lens/stage work is merged; [`plan B`](docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md) (per-display shape and rotation, [`spec B`](docs/superpowers/specs/2026-10-26-display-rotation-design.md)) is the next plan, and the queued backlog drain follows it.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md` — tasks 1–5 (transform, scene presentation, host record, pair page, delivery and Host controls) are implemented; Task 6 (browser proof and gate) remains.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Display presentation in plan B:** per-record shape and rotation, rotated/inscribed playback, pair-page choice, Host controls.
- **Audit, chart, spacing and fonts work is on `main`:** revision gating, memoised dirty reading, chart animation and the fonts/assets rework are landed.
- **Backlog drain stays queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, after plan B.

## Last completed change

- **Player follows the host's glass:** the publish poll reports a validated shape and whole-degree angle only when it moves, refusing out-of-range, fractional and string angles; `main.ts` hands it to `updatePresentation`.
- **Host controls:** a selected paired display gets Rect/Circle and a rotation track (quarter turns for rect, whole degrees for circle) with the degree mark on both.
- **The row is the host's answer:** a write is never drawn optimistically, and a refused write leaves the row on its previous value.
- **No borrowed sentence:** `this-pc` and the default say why they have no controls; an empty or failed display read renders no body.
- **Evidence:** 147 cases across the five affected suites pass; the follower's guards, snap, neutral-row replacement, refusal, degree mark and absence gating were each shown red with the behaviour disabled; typecheck exit 0.

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
