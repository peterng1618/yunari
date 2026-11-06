# 0108 — Panel clips turn by angle on a disc, and the fill is baked from the authored gradient

- **Date:** 2026-11-05
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-video-turn.ts`,
  `src/web/packages/host/src/panels/panel-video-composition.ts`,
  `src/web/packages/host/src/panels/turzx-video.ts`,
  `src/web/packages/host/src/panels/tur-usb-video.ts`,
  `src/web/packages/host/src/panels/panel-device.ts`

## Problem

A display's background media can be mirrored and can sit on a circular panel,
but the bake pipeline only knew quarter turns from the placement's rectangle.
A flip on a video has no canvas equivalent on the panel feed, and a circular
panel's disc is measured in a square box the rotated bounding box can be
smaller than. The theme's colour fill is also a gradient behind an anchored
media region; baking it with ffmpeg's `gradients` source produced a different
alpha ramp from the renderer's, so the panel did not match the player.

## Rung 1 — internal owner
Found: `panelVideoPlacement` already carries the authored media placement;
`turzx-video.ts` and `tur-usb-video.ts` each own their filter chain, and
`panel-video-composition.ts` owns the composition graph. The gap was that a
turn was a rectangle-only concept and the fill had no owner that could express
a stop's offset and alpha.

## Rung 2 — installed dependencies
Found: no installed library produces this filter graph; `ffmpeg-static` is the
binary the pipeline already runs.

## Rung 3 — native platform
Found: ffmpeg's `rotate`, `hflip`, `vflip`, `scale`, `crop` and `geq` filters
cover the transform and the fill. `gradients` interpolates stop colours but not
the authored alpha offsets the renderer uses.

## Rung 4 — public solutions
Searched: ffmpeg filter documentation for `rotate` (rotated width/height
expressions), `scale` (`force_original_aspect_ratio`), and `geq`.
Found: `rotate` needs an explicit output size for a non-rectangular target;
`scale` + `crop` is the documented way to fill a fixed box after rotation;
`geq` evaluates per-pixel expressions, so a stop list can be encoded directly.

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| `gradients` source | Reaches the panel | Alpha and offsets differ from the renderer | Reject for the fill |
| `geq` from parsed stops | Same numbers the player paints | Expression generation | Chosen |
| Rotate then crop at the box | Keeps the wire's long edge | Rotated box can be smaller than the box | Add a scale before the crop |

## Rung 6 — smallest probe
Ran the generated graph against a real clip: rotate + crop failed with
"Invalid too big or non positive size" until the scale step; the `geq` fill
rendered alpha 255 → 207 → 127 → 2 across the stops, matching the authored
offsets.

## Decision
`PanelVideoRotation` (a quarter turn or an angle with its display shape) is the
placement's one rotation value; both drivers normalize to it. Flips are applied
before the rotation. A circle uses the angle form with a square box. The fill is
generated as `geq` over the authored stops, premultiplied per channel; the
`gradients` source stays for masks, whose geometry it already matches.
