# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support`

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape, COM5) through the host's panel subsystem, with a hardware-support record, a controls surface, and phased video-background support.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-29-turzx-serial-panel.md` (3 phases / 12 tasks); tasks 1–5, 9–12 done; tasks 6–8 (controls, route, dialog) remain.
- **Video works on the panel:** the demo theme's clip uploads, plays, and the UI overlay updates over it; a start failure falls back to stills.
- **The panel is wedged after a host kill:** COM5 answers "Access denied" to every open with no host running, so a replug or power-cycle is needed before the next hardware run.
- **Device reclaim is designed, not planned:** per-adapter holder names plus one host service, kill + manual guide in one dialog; queued behind this plan.

## Last completed change

- **Task 12 — video mode on the panel:** the runner starts the clip once, sends transparent overlay diffs, falls back to stills on a failed start or overlay, and stops the clip before closing.
- **Lifecycle hardened over four review rounds:** one chain per display, retryable close, bounded shutdown, replies buffered at the transport instead of per read.
- **Transport defect found on hardware:** replies arriving while the upload still writes were dropped; the probe kept one listener for the session.
- **Register:** `vg-788` (JPEG-compressed stills) closed as verified; commits `4231658d`, `0909562c`.

## Next

1. Tasks 6–8 — controls in the adapter, the command route, the Controls dialog.
2. Whole-branch review on the most capable model, then finish the branch.
3. Replug the panel and repeat the video proof, including glass over video.

## Blockers / unverified

- **COM5 is wedged:** a replug or power-cycle is required; without it no hardware step can run.
- **Overlay alpha and glass over video are unverified on pixels:** the device accepted every frame, but no capture proof exists.
- **A gate flake is open:** `server.test.ts` theme-assignment ordering fails only under full-load (`vg-637` class); it passes alone and with the panel suite.
- **The vendor apps stay closed:** `TURZX.exe` and `Jungle Leopard Display.exe` will reclaim COM5 when reopened.
- **Only firmware `1.88` is verified:** a newer ROM may change the protocol silently.
