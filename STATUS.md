# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

Plan B and plan A are merged into `main`; the queued backlog drain is next, starting at a reproduction pass.

## Active work

- **No plan is running:** plan A and plan B are merged into `main`, archived, and their specs marked landed.
- **Backlog drain is next:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, starting at a reproduction pass over the register.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **The live line no longer corrects at its right edge:** `liveTail` derives the hold and step from every sample gap, so the batch after a stall no longer slopes a flat stretch already painted.
- **Audit, chart, spacing and fonts work is on `main`:** revision gating, memoised dirty reading, chart animation and the fonts/assets rework are landed.

## Last completed change

- **Both plans are archived and both specs marked landed:** the preview lens and per-display shape/rotation; nothing else is active.
- **The final review is closed:** the plate ruling sits in ADR-0125, the three files past the 800-line stop are split, the snap note has a red-proved test, the PATCH body is asserted, and the browser sample now discriminates a turned canvas.
- **The register's ids re-collided with main:** main minted `vg-753`/`vg-754`, so plan B's rows became `vg-756`–`vg-758` with their content unchanged.
- **Per-display shape and rotation ship:** a display stores `shape` and whole-degree `rotation` — rect quarter turns, circle 0–359 — the transform rotates then fits and inscribes a circle, and the Host edits both against its own answer.
- **Evidence:** `npm run gate` exit 0 on the merge commit (435 files / 6735 passed, 2 skipped; browser 13 files / 130 passed); the fixes since are covered by focused suites plus a final gate.

## Next

1. Resume the backlog-drain plan at Phase 0, a reproduction pass over the register.
2. Owner test of the live line's right edge, in the editor and on a phone, with machine sensors.
3. Decide whether the 2 s delay should follow the received cadence: the host drops every other batch under backpressure (`vg-753`).
4. Triage the pre-existing browser reds recorded below.
5. Owner tests listed below remain: segment spacing and fill, radar and polar bar, scene export.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`; host-player's theme-chooser case is `vg-758` (`/api/themes` is loopback-only, so a LAN display's 403 disposes the chooser).
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
- **Deferrals are filed:** `vg-746`–`vg-751` from plan A; `vg-756`–`vg-760` from plan B, including the screen-fixed gradient plate and the quarter-turn rule written in six places.
