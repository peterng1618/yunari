# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support`

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape, COM5) through the host's panel subsystem, with a hardware-support record, a controls surface, and phased video-background support.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-29-turzx-serial-panel.md` (3 phases / 12 tasks); all 12 tasks done; whole-branch review and branch finish remain.
- **Video works on the panel:** the demo theme's clip uploads, plays, and the UI overlay updates over it; a start failure falls back to stills.
- **The panel is wedged after a host kill:** COM5 answers "Access denied" to every open with no host running, so a replug or power-cycle is needed before the next hardware run.
- **Device reclaim is designed, not planned:** per-adapter holder names plus one host service, kill + manual guide in one dialog; queued behind this plan.

## Last completed change

- **Task 8 — the Controls dialog:** brightness (field-level 0–100 refusal), screen on/off, restart behind a two-step confirm, status/identify, the support/firmware line with a mismatch warning, last reply and inline errors.
- **Commands are serialised in the dialog:** one in flight at a time, a stale reply is dropped, and the dialog resets on close and across panels.
- **Refusal path pinned:** `panelCommand` throws the host's plain-text 409 body, and the dialog shows it as an alert.
- **Gate:** exit 1 on the known `server.test.ts` theme-assignment load flake only (passes alone, 403/403); every panel and editor suite green.

## Next

1. Whole-branch review on the most capable model, then finish the branch.
2. Replug the panel and prove the controls and the video overlay on hardware.
3. Reclaim-device spec — designed, awaiting the user's approval of the shape.

## Blockers / unverified

- **COM5 is wedged:** a replug or power-cycle is required; without it no hardware step can run.
- **No control is hardware-verified:** brightness, screen, status, restart and identify were never sent to the device; the dialog is proven by tests only.
- **Overlay alpha and glass over video are unverified on pixels:** the device accepted every frame, but no capture proof exists.
- **A gate flake is open:** `server.test.ts` theme-assignment ordering fails only under full-load (`vg-637` class); it passes alone and with the panel suite.
- **Only firmware `1.88` is verified:** a newer ROM may change the protocol silently, and the vendor apps reclaim COM5 when reopened.
