# 0028 — Background media geometry has one owner

- **Date:** 2026-11-08
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/background-composition.ts`,
  `src/web/packages/scene-fabric/src/background-media.ts`,
  `src/web/packages/host/src/panels/panel-video-composition.ts`,
  `src/web/packages/host/src/panels/turzx-video.ts`,
  `src/web/packages/host/src/panels/tur-usb-video.ts`

## Problem

Where a background picture sits is derived in four places that must agree:
`scene-fabric`'s `placement()`, the host's `panelCrop()`, the USB panel's inline
ffmpeg `panelFilter()`, and `video-frame.ts`'s `cropPlan()`. They already
disagree — the USB copy and `cropPlan` inflate the zoom with `panFloor`, the
DOM applies it through `placement` — and a miss fails quietly: the device shows
a picture the page does not. The authored semantics must also change from
"zoom inside a fixed media area" to "scale and offset move the area itself".

## Rung 1 — internal owner

Searched: CodeGraph for `resolveBackgroundComposition`, `placement`,
`panelCrop`, `cropPlan`, `panelFilter`, `backgroundGeometryOf`, `panFloor`.

Found: `renderer-core/src/theme/background-composition.ts` already owns the
base area (contain-fit for `center`, extent band for edges) and the masks, and
every surface already calls it. The unsolved part is that it stops at the base
area while four other modules repeat cover/zoom/pan. The resolver is the
existing seam; extending it removes the copies instead of adding a mechanism.

## Rung 2 — installed dependencies

Searched: installed `ffmpeg-static` package and binary, its `crop`, `scale`,
`overlay`, `gradients`, `geq` usage in `panel-video-composition.ts`; Fabric's
object model (no media geometry; the background is a DOM layer).

Found: `ffmpeg-static@5.3.0` ships ffmpeg 6.1.1. `crop=w:h:x:y` takes integer
windows; `scale=w:h:force_divisible_by=2` returns the requested size rounded to
even; `overlay=x:y` accepts non-negative coordinates. A scale from one aspect
to another **adjusts SAR to preserve the input display aspect** (probe below),
so an encoded panel stream needs `setsar=1`. Fabric donates nothing here: the
media is a sibling DOM element and the glass sampler.

## Rung 3 — native platform

Searched: MDN `CanvasRenderingContext2D.drawImage` and the canvas image guide;
CSS `object-fit`/`mask-image` as they apply to an absolutely positioned
`<img>`/`<video>` inside an `overflow:hidden` box.

Found: the 9-argument `drawImage(image, sx, sy, sWidth, sHeight, dx, dy,
dWidth, dHeight)` is exactly the crop→dest primitive the DOM, glass and encoder
need, and it accepts float source coordinates. `object-fit` does not apply to a
layer whose size is authored per-axis, and CSS cannot give the host an integer
source window. The resolver's arithmetic therefore stays pure JS; CSS paints
masks and the canvas paints the sample.

## Rung 4 — public solutions

Searched: "ffmpeg scale filter force_original_aspect_ratio increase crop
expression exact output size cover fit"; "canvas drawImage nine argument source
rectangle destination rectangle cover crop MDN".

Found:

- Creatomate, *How to Change the Resolution of a Video using FFmpeg*:
  `scale=W:H:force_original_aspect_ratio=increase,crop=W:H` is the standard
  cover fit; it derives the window from the filter's own arithmetic, which the
  host cannot use because it needs a source window handed to `crop` explicitly.
- kinopipe, *FFmpeg resize video: scale, fit and crop*: `crop=W:H:x:y` with an
  explicit window, `-2`/`force_divisible_by=2` for even sizes, and the warning
  that a crop-then-scale chain must end with `setsar=1` or an anamorphic SAR
  survives.
- MDN `drawImage()`: the 9-argument form maps one source rectangle onto one
  destination rectangle and is the canvas-native equivalent of the encoder's
  crop→scale chain.
- stackoverflow/llogan: `scale=…:increase,crop=…` is still expression-driven;
  it cannot tell the host which source window an arbitrary dest used.

Unsolved by all of them: the authored area/scale/offset rule and the visible
`cover ∩ box` intersection. Those are Yunari's product rule, not a
library capability.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep four copies, change each | Each consumer thinks in its own primitive | Four edits per rule change; silent disagreement | Rejected — the defect being fixed |
| ffmpeg-only owner | Correct filter graphs | DOM and glass cannot call ffmpeg | Rejected |
| DOM-only owner | Correct element rects | Encoders and canvas cannot call the DOM | Rejected |
| Shared pure resolver in `renderer-core` | DOM, glass, both encoders, transcode and player all read one result | Consumers still map box px to device px and round for encoding | **Chosen** |
| CSS/`object-fit` per surface | Browser does cover | No source window for encoders; no shared area rule | Rejected |

## Rung 6 — smallest probe

Ran the installed binary on a 160×90 source:

```bash
ffmpeg -f lavfi -i testsrc=size=160x90:rate=1 -frames:v 1 \
  -vf "crop=80:20:40:35,scale=160:44:force_divisible_by=2" out.png
```

Output: `Video: png, rgb24, 160x44 [SAR 11:10 DAR 4:1]`. Adding `setsar=1` gave
`160x44 [SAR 1:1 DAR 40:11]`. This settles two things the design depends on:
explicit integer `crop` windows and `force_divisible_by` work, and an encoded
plain/transcode chain must end `setsar=1` so the destination rect's pixels are
square.

## Decision

Extend `resolveBackgroundComposition` to take the authored geometry and return
`{ region, masks, media: { cover, dest, crop } }`, plus a shared
`backgroundGeometry(media)`. Every surface reads that result:

- `scene-fabric` places the live element at `cover` and a host-baked clip at
  `dest`, and paints the glass from the same result;
- `panel-video-composition.ts` owns one `panelFilter()` used by both the USB and
  TURZX encoders, with `composeFilterGraph` and a plain crop→scale built from
  the shared `crop`/`dest`;
- `theme-media.panelVideo` and `video-frame.transcodeVideo` encode only `dest`;
- the plain and transcode scale chains end `setsar=1`.

Delete `placement()`, `panFloor`, `panelCrop()`, both device-local
`panelFilter`/`plainFilter` implementations, `cropPlan()` and
`backgroundGeometryOf()`. Rejected: keeping any per-surface copy (the defect),
and delegating to a library or native feature that cannot serve all surfaces.
