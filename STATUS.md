# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support`

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape, COM5) through the host's panel subsystem, with a hardware-support record, a controls surface, and phased video-background support.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-29-turzx-serial-panel.md` (3 phases / 12 tasks); Phase 1 tasks 1–5 done, video pulled forward (9 done, 10 next), then 11, 12, then 6–8.
- **The TURZX panel is attached on COM5** (`1D6B:0106`, Windows serial `6&E9576A&5&0000`) and answers HELLO as `chs_5inch.dev1_rom1.88`.
- **The panel shows a Yunari theme:** static frames reach the glass upright; a theme video uploads and starts (`884d1c1e`), overlay updates are Task 11.
- **Device reclaim is designed, not planned:** per-adapter holder names plus one host service, kill + manual guide in one dialog; queued behind this plan.
- **Task 10 is host-only:** a devtools-side transparent capture; no player flag or scene option.

## Last completed change

- **Docs — overlay capture is a devtools edit:** `captureOverlay()` hides the media layer and clears the artboard host's inline paint, which the canvas leaves to the host.
- **Glass first frame is inherited:** the Lian Li still-frame seam (`226acf66`) supplies it at merge; this plan ports interfaces only.
- **Spec and plan amended** (Capture, phasing, glass acceptance, Task 10/12); glass-over-video risk recorded for Task 12.

## Next

1. Task 10 — transparent overlay capture (devtools only).
2. Task 11 — diff encoder and `presentOverlay`; Task 12 — video mode, fallback, hardware proof.
3. Tasks 6–8 — controls, route, dialog; then the reclaim spec and plan.

## Blockers / unverified

- **Only firmware `1.88` is verified:** a newer ROM may change the protocol, and the mismatch warning is the only signal.
- **A replug invalidates the open serial handle:** the runner keeps logging success against a dead port; no reconnect logic exists yet.
- **The vendor apps were stopped by us:** `TURZX.exe` and `Jungle Leopard Display.exe` are closed and will reclaim COM5 when reopened.
- **The video seam's glass behaviour is unverified here:** it arrives with the Lian Li work; a glass object over video may carry video pixels into the overlay.
