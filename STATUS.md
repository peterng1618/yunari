# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support`

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape, COM5) through the host's panel subsystem, with a hardware-support record, a controls surface, and phased video-background support.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-29-turzx-serial-panel.md` (3 phases / 12 tasks), Phase 1 tasks 1–4 done, task 5 next.
- **The TURZX panel is attached on COM5** (`1D6B:0106`, Windows serial `6&E9576A&5&0000`) and answers HELLO as `chs_5inch.dev1_rom1.88`.
- **The panel now shows a Yunari theme:** static frames reach the glass and are upright.
- **Device reclaim is designed, not planned:** per-adapter holder names plus one host service, kill + manual guide in one dialog; queued behind this plan.
- **The video phase builds on the Lian Li worktree:** it is implementing the shared video-background seam; Phase 3 merges and reuses it.

## Last completed change

- **Task 4 — first frame on the panel:** the runner skips an overlapping tick, and the human confirmed `starter dashboard` upright on the glass.
- **Wire bug found on hardware:** `DISPLAY_BITMAP_5INCH` needs its two-byte length `0e 10`; the six-byte prefix made the panel drop every frame.
- **Evidence:** 8 protocol tests pass with a join assertion that fails without the join; host gate EXIT=0 (7017 passed, 1 skipped).

## Next

1. Task 5 — support record, detected firmware and the held-panel listing.
2. Tasks 6–8 — controls in the adapter, the command route and the dialog.
3. Phase 3 after the Lian Li video seam lands, then the reclaim spec and plan.

## Blockers / unverified

- **Only firmware `1.88` is verified:** a newer ROM may change the protocol, and the mismatch warning is the only signal.
- **A replug invalidates the open serial handle:** the runner keeps logging success against a dead port; no reconnect logic exists yet.
- **The vendor apps were stopped by us:** `TURZX.exe` and `Jungle Leopard Display.exe` are closed and will reclaim COM5 when reopened.
- **The Phase 3 video seam is being built in the Lian Li worktree:** its interfaces are unknown until that work merges.
- **The Lian Li glass and the Kraken upload remain unverified** (inherited from the branch).
