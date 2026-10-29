# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support` (merged into `main` and pushed: `1c4e371` plus this commit)

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape) through the host's panel subsystem, with a hardware-support record, a controls surface, and video-background support with a transparent UI overlay.

## Active work

- **The panel campaign is complete and integrated:** all 12 tasks done, whole-branch review clean after one fix round; `main` pushed through `1c4e371`, and the panel's glass now defaults to a static first-frame still.
- **One `PanelVideo` contract** now serves the Lian Li driver and the TURZX adapter; the branch's stop chain and main's release-before-restart both survive the merge.
- **Hardware partially proven (2026-10-29):** status (`needReSend:0|renderCnt:…`), hello (`chs_5inch.dev1_rom1.88`) and brightness answered 200 on the device; the screen control re-enumerates the panel's USB port.
- **The `screen` command kills the host's port:** after it the runner reports `Cannot call write after a stream was destroyed` once a second and never rediscovers the panel (`vg-789`), so a replug is needed again.
- **Device reclaim is designed, not planned:** per-adapter holder names plus one host service, kill + manual guide in one dialog.

## Last completed change

- **The panel's UI is dithered before 4-bit packing:** `overlayUpdate` adds a 4x4 Bayer fraction of one step before rounding, so a smooth still is no longer 16 flat bands (seen on the panel 2026-10-29).
- **The wire gains nothing:** changed pixels are chosen on the source frame, before quantising; solid black and white stay byte-identical.
- **Red-proved:** dropping the threshold term flattens a 128 grey to one level and fails "dithers a mid tone instead of flat-banding it".
- **Applied to the device:** `@yunari/host` rebuilt and restarted; the panel repaints from the dithered encoder.
- **Confirmed on the panel:** the user sees no colour banding; a fine grain is visible only up close, which is the dither doing its job.

## Next

1. Finish `vg-791`: overlay alpha, glass over video, and a stop that leaves no clip looping.
2. Decide the screen-command policy: report the reconnect, or forbid it until rediscovery works (`vg-789`).
3. Reclaim-device spec — designed, awaiting the user's approval of the shape.
4. Drain the backlog: a reproduction pass first, not a fix pass.

## Blockers / unverified

- **The panel is held and painting:** do not press `screen`/`restart` — they re-enumerate the port and the host never recovers (`vg-789`).
- **Overlay alpha and glass over video are unverified on pixels:** the device accepted every frame, but no capture proof exists.
- **`vg-789`/`vg-790` are the blocking product defects:** unplug and re-enumeration are not handled; a held port is silently invisible.
- **Video stop is unverified:** whether `STOP_VIDEO` leaves the panel still or looping after a host exit was not observed.
- **Only firmware `1.88` is verified:** a newer ROM may change the protocol silently.
