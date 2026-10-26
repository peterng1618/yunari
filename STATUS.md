# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

Plan B (per-display shape and rotation) is complete on the branch and merges into `main` with main's live-line work; the queued backlog drain is next.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-26-display-shape-and-rotation.md` — tasks 1–6 landed; the final branch review, the local merge to `main` and the spec close-out remain.
- **Backlog drain is next:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, starting at a reproduction pass.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **The live line no longer corrects at its right edge:** `liveTail` derives the hold and step from every sample gap, so the batch after a stall no longer slopes a flat stretch already painted.
- **Audit, chart, spacing and fonts work is on `main`:** revision gating, memoised dirty reading, chart animation and the fonts/assets rework are landed.

## Last completed change

- **`main` merged into the branch:** main's live-line and fonts work arrives conflicting only in `STATUS.md` and the register.
- **The register's ids collided again:** main minted `vg-753`/`vg-754`, so plan B's three rows became `vg-756`–`vg-758` with their content unchanged.
- **Per-display shape and rotation:** a display stores `shape` and whole-degree `rotation` — rect quarter turns, circle 0–359 — and a refused write is a 400 in the store's words.
- **Turned fit and circle presentation:** the transform rotates then fits, letterboxing the turned bounding box; a circle inscribes the board and the canvas is clipped to the disc.
- **Delivery and Host controls:** the publish poll carries shape and rotation to `updatePresentation`, and the selected display's row edits both against the host's answer; eight new browser cases pass on desktop and phone.

## Next

1. Dispatch plan B's final whole-branch review, then fast-forward `main` and close the plan and spec in `.superpowers/sdd/`.
2. Resume the backlog-drain plan at Phase 0 after that merge.
3. Owner test of the live line's right edge, in the editor and on a phone, with machine sensors.
4. Decide whether the 2 s delay should follow the received cadence: the host drops every other batch under backpressure (`vg-753`).
5. Triage the pre-existing browser reds recorded below.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`; host-player's theme-chooser case is `vg-758` (`/api/themes` is loopback-only, so a LAN display's 403 disposes the chooser).
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
- **Deferrals are filed:** `vg-746`–`vg-751` from plan A and `vg-756`–`vg-758` from plan B in `docs/product/backlog.jsonl`.
