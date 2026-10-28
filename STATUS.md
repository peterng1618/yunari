# Yunari status

Updated: 2026-10-29
Branch: `peterng1618/lian-li-9.2-monitor-support` (worktree `lian-li-9.2-monitor-support`)

## Current objective

USB panel support behind a `PanelDevice` port: a Lian Li 9.2" LCD (`1CBE:A092`) streamed from the product's own player page, and a NZXT Kraken Z73 (`1E71:3008`) written into its own memory, from one family table (decisions `0130`, `0131`), now with the 9.2" playing a theme's video background on its own decoder (`0134`).

## Active work

- **The video path is live end to end:** the host resolves the panel's assigned theme video, the adapter encodes it, and the runner sends only the UI as a PNG overlay while it plays.
- **The panel's framing is the theme's:** the encoder applies the same cover, pan and zoom-floor rule as `scene-fabric`'s `placement`, so the authored `offsetX/offsetY` survives onto the glass.
- **Playback loops from a background feed** because the vendor driver rewinds at end of file; block writes and overlay pushes share one endpoint lock.
- **`PanelVideo` now takes a `PanelVideoPlacement`** — the contract the TURZX worktree should copy when its adapter lands.
- **The panel is driving the "Lian Li Video Demo" theme** (`4b587826`), verified upright with its UI layer on top.

## Last completed change

- **Video themes play on the 9.2" at its own frame rate** with the UI composited above them.
- **The encoder is corrected in three measured ways:** landscape crop before the clockwise turn, the authored pan inside the crop, and an endless feed instead of a one-shot write.
- **The panel suite is 66 passing cases** and the workspace typechecks.
- **The pipeline was verified on the attached panel:** upright video, upright overlay, looped past the clip's length, framing matching the editor.

## Next

1. Hand the final `PanelVideo` + `PanelVideoPlacement` contract to the TURZX worktree, whose adapter uploads an MP4 instead of streaming blocks.
2. Decide whether the overlay cadence should rise above 1 s while a video plays; the panel only needs it when a sensor reading changes.
3. Restore or confirm the panel's long-term theme assignment once the owner is awake.

## Blockers / unverified

- **Long runs are unmeasured:** the longest session so far is minutes, not hours, and the encoder memory cost is one whole clip.
- **`StopPlay`'s resting picture is unknown:** whether the panel returns to its stored still or holds the last decoded frame.
- **No Kraken upload has run:** the panel is a working cooler, and a wrong bucket setup is a documented route to firmware bootloader, so the write path stays unexercised until it is accepted deliberately.
- **L-Connect must stay stopped:** it relaunches on boot and holds the interface; the host reports the "another program holding it" message when it wins the race.
