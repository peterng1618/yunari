# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/lian-li-9.2-monitor-support` (worktree `lian-li-9.2-monitor-support`)

## Current objective

USB panel support behind a `PanelDevice` port: a Lian Li 9.2" LCD (`1CBE:A092`) streamed from the product's own player page, and an NZXT Kraken Z73 (`1E71:3008`) written into its own memory, from one family table (decisions `0130`, `0131`).

## Active work

- **Two families, one seam:** `panel-families.ts` maps ids to a driver, and neither `panel-manager.ts` nor `server.ts` imports a driver now — a source-text test holds that.
- **The panel record is live:** `lian-li-9-2` on `1CBE:A092` with `rotation: 90`, showing starter theme `27c605ef`, written through the host's own API.
- **The panel is live after the reboot:** with L-Connect stopped the interface was claimed and 32 frames went out in ~35s with zero `Cancelled` lines (`vg-773` keeps the unexplained cause).
- **The Kraken driver runs no upload yet:** HID control, bulk transfer, slot arithmetic and bucket placement are written and tested against measured values, but nothing has been sent to the device.
- **The glass is unverified:** the expected picture is `C:\tmp\yunari-render\expected-panel.jpg`, the rotation-90 render at 464×1920.

## Last completed change

- **A display pairs on the host's mDNS name**, not a dotted quad: the leaf now carries `hostname.local`, and the publish card, its QR and the console banner dial it while printing the address beside it (`decisions/0132`).
- **`lanAddress()` is unchanged** — the name is a second fact on the wire (`HostingState.name`), so a device that cannot resolve `.local` still has an address to type.

## Next

1. Look at the glass and confirm the picture and its orientation.
2. Re-pair one phone against the printed `.local` link and confirm it survives a host restart.
3. Resume the backlog-drain plan at Phase 0.

## Blockers / unverified

- **The glass is unverified:** frames flow, but no eye has confirmed the picture or that rotation 90 reads upright on the strip.
- **No Kraken upload has run:** the panel is a working cooler, and a wrong bucket setup is a documented route to firmware bootloader, so the write path stays unexercised until it is accepted deliberately.
- **L-Connect must stay stopped:** it relaunches on boot and holds the interface; the host reports the "another program holding it" message when it wins the race.
- **The `.local` dial is unverified on a phone:** the leaf was measured on this box (`ERR_TLS_CERT_ALTNAME_INVALID` for a control name, 200 for the real one), but no phone has paired by the name yet.
