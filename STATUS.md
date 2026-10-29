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
- **`main` is merged in:** the Lian Li panel video path (`0134`) and the `0135` fallback-frame/glass model now share one `PanelVideo` contract with the TURZX adapter.

## Last completed change

- **Merged `main` into the TURZX branch:** one `PanelVideo`/`PanelVideoPlacement`/`PanelVideoSource` contract now serves the Lian Li driver and both panel adapters.
- **Both stop paths kept:** the branch's retryable per-display stop/restart chain and main's release-before-restart (`b37d9286`), now awaited on the removal route too.
- **Backlog unioned:** main's and the branch's `vg-789`–`vg-796` rows kept with no duplicate ids.

## Next

1. Choose how to integrate the branch (merge to `develop`, PR, or hold).
2. Replug the panel and run `vg-791`'s hardware session: controls, video, overlay alpha, glass over video, and a stop that leaves no clip looping.
3. Reclaim-device spec — designed, awaiting the user's approval of the shape.
4. Apply the same UI/UX audit to the rest of the app (`vg-780`).
5. Drain the backlog: a reproduction pass first, not a fix pass.

## Blockers / unverified

- **COM5 is wedged:** a replug or power-cycle is required; without it no hardware step can run.
- **No control is hardware-verified:** brightness, screen, status, restart and identify were never sent to the device; the dialog is proven by tests only.
- **Overlay alpha and glass over video are unverified on pixels:** the device accepted every frame, but no capture proof exists.
- **Static and dynamic glass (`0135`) are unproven on the panel:** the browser cases pass, but no fixture theme has been pushed with either setting.
- **`StopPlay`'s resting picture is unknown:** whether the panel returns to its stored still or holds the last decoded frame.
