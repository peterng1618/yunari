# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/turzx-5-inch-display-support`

## Current objective

Drive the TURZX/Turing 5" serial panel (Rev C, 800×480 landscape, COM5) through the host's panel subsystem, with a hardware-support record, a controls surface, and phased video-background support.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-29-turzx-serial-panel.md` (3 phases / 12 tasks); all tasks done, final review clean, awaiting integration choice.
- **Video works on the panel:** the demo theme's clip uploads, plays, and the UI overlay updates over it; a start failure falls back to stills.
- **The panel is wedged after a host kill:** COM5 answers "Access denied" to every open with no host running, so a replug or power-cycle is needed before the next hardware run.
- **Device reclaim is designed, not planned:** per-adapter holder names plus one host service, kill + manual guide in one dialog; queued behind this plan.

## Last completed change

- **Final review found two device-visible defects, both fixed:** a clip started but not acked is now stopped when a later step throws; the transport no longer drops the reply to the command sent right after a drain.
- **Write-only controls no longer fake a device reply:** they return an empty reply and the dialog says "Sent" under "Last command"; device text shows under "Panel reply".
- **Overlay count now starts at 0 to match the verified probe**, and the spec and plan match the code (interface names, trailer threshold, reply meaning).
- **Eight deferred findings filed as `vg-789`–`vg-796`**, so they survive the merge the gitignored ledger did not.
- **Gate green:** `npm run gate` `EXIT=0` (7145 passed, 1 skipped) on the fix round, including the polled replacement for the branch's own flaky test.

## Next

1. Choose how to integrate the branch (merge to `develop`, PR, or hold).
2. Replug the panel and run `vg-791`'s hardware session: controls, video, overlay alpha, glass over video, and a stop that leaves no clip looping.
3. Reclaim-device spec — designed, awaiting the user's approval of the shape.

## Blockers / unverified

- **COM5 is wedged:** a replug or power-cycle is required; without it no hardware step can run.
- **No control is hardware-verified:** brightness, screen, status, restart and identify were never sent to the device; the dialog is proven by tests only.
- **Overlay alpha and glass over video are unverified on pixels:** the device accepted every frame, but no capture proof exists.
- **Only firmware `1.88` is verified:** a newer ROM may change the protocol silently, and the vendor apps reclaim COM5 when reopened.
