# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/turzx-5-inch-display-support`

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 480×800, COM5) through the host's panel subsystem, with a hardware-support record and a controls surface.

## Active work

- **No plan is running:** the panel spec is next; the merged branch is a baseline, not a finished feature.
- **The panel subsystem is merged in:** `PanelDevice`, `panel-families`, runner, rasteriser and the Host-settings add flow came from `peterng1618/lian-li-9.2-monitor-support`.
- **Two USB families exist:** Lian Li TUR panels stream JPEGs and the Kraken Z73 writes into its own storage; neither touches the serial family.
- **The TURZX panel is attached on COM5** (`1D6B:0106`, serial `20080411`) and answers HELLO as `chs_5inch.dev1_rom1.88`.
- **The rough protocol capture is the starting point:** `docs/superpowers/specs/2026-10-18-turzx-panel-displays-design.md` records the families and the serial wire time.

## Last completed change

- **The Lian Li panel branch merged in:** ten commits adding the panel port, family registry, Kraken driver, runner and the Host-settings add flow.
- **Two backlog ids were renumbered:** main had already allocated `vg-773`/`vg-774`, so the wedged-host and orphan-temp rows became `vg-786`/`vg-787`.

## Next

1. Write the TURZX 5" spec: serial transport, hardware-support record, controls modal.
2. Write and execute its plan.
3. Verify frames on the attached panel before closing it.

## Blockers / unverified

- **The serial transport is unmeasured from the host:** 115200 8N1 with RTS/CTS is the reference's setting, but the panel is a USB gadget and the sub-second full frame was seen from another tool.
- **The ROM version comes from the HELLO string** (`rom1.88`), not from a dedicated query.
- **The merged panel work has not been run on this branch:** `npm install` and the gate are still to run.
- **The Lian Li glass and the Kraken upload remain unverified** (inherited from the branch).
