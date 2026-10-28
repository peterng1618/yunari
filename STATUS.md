# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support`

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape, COM5) through the host's panel subsystem, with a hardware-support record, a controls surface, and phased video-background support.

## Active work

- **No plan is running:** the spec is written and awaits review; its plan is next.
- **The panel subsystem is merged in:** `PanelDevice`, `panel-families`, runner, rasteriser and the Host-settings add flow came from `peterng1618/lian-li-9.2-monitor-support`.
- **Two USB families exist:** Lian Li TUR panels stream JPEGs and the Kraken Z73 writes into its own storage; neither touches the serial family.
- **The TURZX panel is attached on COM5** (`1D6B:0106`, Windows serial `6&E9576A&5&0000`) and answers HELLO as `chs_5inch.dev1_rom1.88`.
- **The protocol is now verified, not just captured:** 250-byte framing, static frames, upload/play, and overlay diff updates with visible-list replacement.

## Last completed change

- **The TURZX 5" spec is written:** `docs/superpowers/specs/2026-10-29-turzx-serial-panel-design.md` covers transport, registry, controls and phased video.
- **Hardware probes recorded:** HELLO, video upload/start, overlay init, and diff updates that replace the visible set.

## Next

1. Review the spec, then write its implementation plan.
2. Run `npm install` in `src/web/` and the merged-branch gate.
3. Execute Phase 1 (static panel, registry, controls), then Phase 2 (video).

## Blockers / unverified

- **Only firmware `1.88` is verified:** a newer ROM may change the protocol, and the mismatch warning is the only signal.
- **The merged panel work has not been run on this branch:** `npm install` and the gate are still to run.
- **The Lian Li glass and the Kraken upload remain unverified** (inherited from the branch).
- **The vendor application claims COM5 exclusively:** probing fails until it is closed.
