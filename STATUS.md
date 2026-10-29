# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support` (merged into `main` and pushed as `a20ffc8f`)

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape) through the host's panel subsystem, with a hardware-support record, a controls surface, and video-background support with a transparent UI overlay.

## Active work

- **The panel campaign is complete and integrated:** all 12 plan tasks done, whole-branch review clean after one fix round, `main` at `a20ffc8f`.
- **One `PanelVideo` contract** now serves the Lian Li driver and the TURZX adapter; the branch's stop chain and main's release-before-restart both survive the merge.
- **Hardware partially proven (2026-10-29):** status (`needReSend:0|renderCnt:…`), hello (`chs_5inch.dev1_rom1.88`) and brightness answered 200 on the device; the screen control re-enumerates the panel's USB port.
- **The `screen` command kills the host's port:** after it the runner reports `Cannot call write after a stream was destroyed` once a second and never rediscovers the panel (`vg-789`), so a replug is needed again.
- **Device reclaim is designed, not planned:** per-adapter holder names plus one host service, kill + manual guide in one dialog.

## Last completed change

- **Merged `main` into the branch and pushed `main`:** `38a1b58b` merge, `a20ffc8f` poll fix; gate `EXIT=0` (469 files / 7173 passed).
- **Conflicts resolved with both sides kept:** main's Lian Li video methods and `0134`/`0135` work plus the branch's TURZX lifecycle; one duplicate `PanelVideo` removed.
- **Backlog unioned:** `vg-789`–`vg-796` filed; `vg-789` now carries the observed screen-command re-enumeration.
- **Hardware run:** brightness 50, screen off, hello and status all reached the device before the port died.

## Next

1. Replug the panel, then finish `vg-791`: overlay alpha, glass over video, and a stop that leaves no clip looping.
2. Decide the screen-command policy: report the reconnect, or forbid it until rediscovery works (`vg-789`).
3. Reclaim-device spec — designed, awaiting the user's approval of the shape.
4. Drain the backlog: a reproduction pass first, not a fix pass.

## Blockers / unverified

- **The panel needs another replug:** the `screen` control re-enumerated it and the host never recovered the port.
- **Overlay alpha and glass over video are unverified on pixels:** the device accepted every frame, but no capture proof exists.
- **`vg-789`/`vg-790` are the blocking product defects:** unplug and re-enumeration are not handled; a held port is silently invisible.
- **Video stop is unverified:** whether `STOP_VIDEO` leaves the panel still or looping after a host exit was not observed.
- **Only firmware `1.88` is verified:** a newer ROM may change the protocol silently.
