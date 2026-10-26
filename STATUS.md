# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

[`Plan B`](docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md) (per-display shape and rotation, [`spec B`](docs/superpowers/specs/2026-10-26-display-rotation-design.md)) is complete; the queued backlog drain is next.

## Active work

- **Plan B complete:** `docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md` — tasks 1–6 landed; local merge to `main` and the spec close-out remain for the controller.
- **Backlog drain is next:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, starting at a reproduction pass.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Audit, chart, spacing and fonts work is on `main`:** revision gating, memoised dirty reading, chart animation and the fonts/assets rework are landed.

## Last completed change

- **Record:** a display stores `shape` and whole-degree `rotation`, rect quarter turns only, circle 0–359; a refused write is a 400 in the store's words.
- **Rotated fit:** the artboard transform turns the composition, letterboxes the turned bounding box, and inscribes the board in a circle's disc.
- **Circle presentation:** the canvas is clipped to the disc, a display-bounded media fills it, and theme-bounded media turns with the composition.
- **Delivery and Host controls:** the publish poll carries shape and rotation to `updatePresentation`, and the selected display's row edits both against the host's answer.
- **Evidence:** eight new browser cases pass on desktop and phone; each changed case was shown red with its behaviour disabled; `npm run gate` exit 0.

## Next

1. Local merge of plan B into `main`, then close the plan and spec in `.superpowers/sdd/`.
2. Resume the backlog-drain plan at Phase 0.
3. Triage the pre-existing browser reds recorded below.
4. Owner tests remain: segment spacing and fill, radar and polar bar, scene export, fonts and assets rework.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`; host-player's theme-chooser case is `vg-755` (`/api/themes` is loopback-only, so a LAN display's 403 disposes the chooser).
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
- **Plan A's deferrals are filed:** `vg-746`–`vg-751` in `docs/product/backlog.jsonl`.
