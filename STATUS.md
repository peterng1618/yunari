# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support`

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape, COM5) through the host's panel subsystem, with a hardware-support record, a controls surface, and phased video-background support.

## Active work

- **No plan is running:** the plan is written at `docs/superpowers/plans/2026-10-29-turzx-serial-panel.md` and awaits review; the spec is approved.
- **The plan has 3 phases / 12 tasks:** serial codec and adapter, support record and controls, then the video overlay.
- **The video phase builds on the Lian Li worktree:** it is implementing the shared video-background seam; Phase 3 merges and reuses it.
- **The panel subsystem is merged in:** `PanelDevice`, `panel-families`, runner, rasteriser and the Host-settings add flow came from `peterng1618/lian-li-9.2-monitor-support`.
- **The TURZX panel is attached on COM5** (`1D6B:0106`, Windows serial `6&E9576A&5&0000`) and answers HELLO as `chs_5inch.dev1_rom1.88`.

## Last completed change

- **The TURZX 5" implementation plan is written:** 3 phases, 12 tasks, with the modular registry, controls route and overlay diff encoder.
- **The TURZX 5" spec is written:** `docs/superpowers/specs/2026-10-29-turzx-serial-panel-design.md` covers transport, registry, controls and phased video.
- **Hardware probes recorded:** HELLO, video upload/start, overlay init, and diff updates that replace the visible set.

## Next

1. Review the plan and choose subagent-driven or native execution.
2. Run `npm install` in `src/web/` and the merged-branch gate.
3. Execute plan Phases 1–2, then Phase 3 after the Lian Li video seam lands.

## Blockers / unverified

- **Only firmware `1.88` is verified:** a newer ROM may change the protocol, and the mismatch warning is the only signal.
- **The Phase 3 video seam is being built in the Lian Li worktree:** its interfaces are unknown until that work merges.
- **The merged panel work has not been run on this branch:** `npm install` and the gate are still to run.
- **The Lian Li glass and the Kraken upload remain unverified** (inherited from the branch).
- **The vendor application claims COM5 exclusively:** probing fails until it is closed.
