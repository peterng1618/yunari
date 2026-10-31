# 0031 — A panel's clip turns with its display

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-device.ts`,
  `src/web/packages/host/src/panels/panel-runner.ts`,
  `src/web/packages/host/src/panels/panel-manager.ts`,
  `src/web/packages/host/src/panels/turzx-panel.ts`,
  `src/web/packages/host/src/panels/turzx-video.ts`,
  `src/web/packages/host/src/main.ts`,
  `src/web/packages/host/src/server.ts`

## Problem

A TURZX panel whose display record sets a mounting angle shows the overlay
turned and the clip behind it upright. The overlay is a capture of the player
page, and the page applies `presentationForDisplay`'s rotation to the whole
composition; the clip is a file the device decodes itself and never sees the
page. `PanelVideoSource` carried only the bytes and the authored pan, so the
mounting angle stopped at the manager and the transcode composed an upright
800×480 frame.

## Rung 1 — internal owner

`turzx-video.ts` owns the one conversion: `panelFilter` crops the source window
`scene-fabric`'s `placement()` places and scales it to the 800×480 box.
`main.ts`'s `videoFor` owns what a panel plays and reads the theme envelope; the
display record — where `rotation` lives — was not read there.
`panel-device.ts` owns the shape crossing the driver boundary, and
`PanelVideo.start` had no field for an angle. On the player side
`scene-fabric`'s `displayBox` already states what a display-bounded media layer
does on a turned glass: a 90°/270° mount swaps the layer's width and height and
turns it about its centre, so it still covers the viewport.

## Rung 2 — installed dependencies

`ffmpeg-static`'s `-vf` chain has `transpose=1` (90° clockwise), `transpose=2`
(90° counter-clockwise) and `hflip,vflip` (180°), all exact for quarter turns
and all output-size preserving where the chain says so. No new dependency.

## Rung 3 — native platform

There is no platform rotation for this panel. It decodes an H.264 elementary
stream stored on its own SD card and composites a PNG layer over it; the wire
has no orientation command in the TURZX command table (`turzx-protocol.ts`), so
the host must turn the bytes.

## Rung 4 — public solutions

Searched: `mathoudebine/turing-smart-screen-python` (issue #90 reverse-engineers
the 5" media commands), `RexPhoe/open-turzx` (`DEVLOG.md` protocol summary), and
the TURZX forum's update/video protocol thread. Found: the protocol carries
`play video <path>` and no orientation field; every implementation that mounts a
panel turned corrects the picture **on the host side** — `open-turzx` renders
and then `to_jpeg(rotate=180°)` before `SEND_JPEG`. `turing-smart-screen-python`
offers screen rotation as a host render step and does not support video at all.
None rotates a file already uploaded to the device, because the device has no
way to be told.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Turn the page only (today) | The overlay is a capture, so it is correct for free | The device plays the clip itself and never sees the page | Reject |
| Turn the source widely, then crop the landscape window | One transpose at the front | Rotating before the crop shows a different part of the clip than the player's turned layer | Reject |
| **Fit the swapped box, then turn, in the transcode** | **Same box `displayBox` states and the same `placement` owner** | A quarter-turn filter per mount angle; the cache key must carry the angle | **Adopt** |
| Upload the clip raw and rotate in the overlay | No second encode | The overlay is a transparent UI capture; painting video into it is sending every frame over the wire again | Reject |

## Rung 6 — smallest probe

`transcodeForPanel` over the bundled ffmpeg, on a generated 480×800 clip with a
white square inside both the upright crop window and the whole frame; each
angle's first output frame decoded to `rgb24` and averaged per quadrant:

| Rotation | Brightest quadrant |
|---|---|
| 0° | top-left |
| 90° | top-right |
| 180° | bottom-right |
| 270° | bottom-left |

The square moves clockwise with the angle, which is the composition's turn.
Hardware confirmation on the attached panel is still owed.

## Decision

`PanelVideoSource` and `PanelVideo.start` carry the display's `rotation`
(omitted or `0` means upright). `turzx-video.ts` checks it is a quarter turn,
folds it into the cache key, lays the clip out in the swapped box for 90°/270°,
and applies `transpose=1`, `hflip,vflip` or `transpose=2` after the scale. A
panel record change re-reads the clip through `panels.refreshVideo`, so changing
the angle re-uploads it. The Lian Li driver keeps its own fixed turn onto the
portrait wire and is unchanged.

Skipped: angle-dependent crop for non-quarter turns. Add when a panel record can
hold one (a round display's free angle), with `rotate` rather than `transpose`.
