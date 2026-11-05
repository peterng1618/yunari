# 0029 — Background composition: anchor, colour and fade

- **Date:** 2026-11-04
- **Status:** accepted
- **Paths:**
  `src/web/packages/renderer-core/src/theme/document.ts`
  `src/web/packages/renderer-core/src/theme/envelope-keys.ts`
  `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`
  `src/web/packages/renderer-core/src/theme/background-composition.ts`
  `src/web/packages/renderer-core/src/index.ts`
  `src/web/packages/renderer-core/src/scene/plan.ts`
  `schema/theme-document.schema.json`
  `src/web/packages/scene-fabric/src/background-media.ts`
  `src/web/packages/scene-fabric/src/scene.ts`
  `src/web/packages/scene-fabric/src/index.ts`
  `src/web/packages/scene-fabric/src/glass.ts`
  `src/web/packages/scene-fabric/src/artboard-backdrop.ts`
  `src/web/packages/host/src/panels/panel-device.ts`
  `src/web/packages/host/src/panels/panel-video-composition.ts`
  `src/web/packages/host/src/panels/turzx-video.ts`
  `src/web/packages/host/src/panels/tur-usb-video.ts`
  `src/web/packages/host/src/themes/theme-media.ts`
  `src/web/packages/mcp/src/tools/draft.ts`
  `src/web/packages/editor/src/selection-inspector/background-column.ts`
  `src/web/packages/editor/src/selection-inspector/view.ts`

## Problem

A background media layer is clipped to one box — the artboard or the display —
and always covers it. An author cannot put the clip in part of the box and show
the background colour in the rest, and a fade authored as a scene scrim is
painted through the artboard transform. On a display whose ratio differs from
the artboard the scrim stops at the artboard; on a TURZX panel its ramp enters
the 4-bit overlay alpha and bands (issue #419). The composition must be
display-bounded by construction and, on a panel, must stay in the 8-bit video
plane.

## Rung 1 — internal owner

Searched: source under `renderer-core/src/theme/` and `scene-fabric/src/`.
No CodeGraph index exists in this worktree.

Found: `Background` in `document.ts` owns `color` and `media`; `BackgroundMedia`
owns `bounds`, pan, zoom and flips. `background-media.ts` is the only renderer of
the media layer and `placement()` already bounds pan/zoom against the layer box.
`artboard-backdrop.ts` samples that layer for glass, and
`turzx-video.ts` bakes it for the panel clip. `planArtboard` is where a paint is
resolved from a `StyleValue`, and `cssArtboardPaint` is the existing CSS form of
a resolved paint. Unsolved: nothing in these owners expresses a sub-box region
or an alpha ramp at one edge.

## Rung 2 — installed dependencies

Searched: `src/web/node_modules/ffmpeg-static`, its bundled binary's filter help;
`package.json` for any canvas/image library.

Found: ffmpeg-static 6.1.1 exposes `gradients` (2–8 stops, explicit x0/y0/x1/y1
line), `geq`, `alphamerge` (second input's luma becomes alpha), `maskedmerge`
(third input is a per-pixel mask) and `color`. No installed library provides
CSS-mask or panel-mask geometry; adding one would duplicate the resolver below.
No dependency is added.

## Rung 3 — native platform

Searched: browser CSS masking (`mask-image`, `-webkit-mask-image`, `mask-size`);
canvas compositing (`destination-in`); the ffmpeg graph surface above.

Found: a CSS `linear-gradient`/`radial-gradient` on a positioned wrapper is the
native mask form, and the product's panels already require a Chromium-family
browser. Canvas has `destination-in` for the glass sampler, but applying it to a
shared backdrop context would erase the rest of the sample, so it must run in a
scratch canvas sized to the region. ffmpeg composition is a filter graph, not an
API call; the renderer still owns the geometry.

What remains unsolved natively: one shared definition of the region and ramp, so
the DOM, the sampler and the bake cannot disagree.

## Rung 4 — public solutions

Searched: web search was unavailable in this session; the local sources below
stand in for it. Consulted the CSS Masking specification
(<https://www.w3.org/TR/css-masking-1/>), MDN's `mask-image`/`mask-size` pages
(<https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image>), and the ffmpeg
filter reference for `gradients`, `geq`, `alphamerge`, `maskedmerge` and `color`
(<https://ffmpeg.org/ffmpeg-filters.html>), plus the bundled binary's own
`-h filter=` output (rung 6).

Found: CSS masking handles arbitrary gradients and sizes but has no notion of a
theme's bounds box or palette; ffmpeg can composite a masked video over a
generated colour but its coordinates are pixels in the turned panel box. Neither
supplies the mapping from authored fractions to those pixels. Comparable
implementations all keep the authored geometry in the document and derive each
surface from it, which is what this decision does.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Mask/region primitive on scene objects | Scene objects are painted through the artboard transform, so a display-ratio fade still stops at the artboard; TURZX overlay alpha is 4-bit and bands | A second transform space and a new overlay encoder | Rejected: cannot be display-bounded by construction |
| Separate overlay tint layer | A tint above the media is a second paint layer, not the media's alpha; it hides the fill colour choice and still rides the artboard transform | A new layer type, selection and persistence | Rejected: solves a different feature (recolour) and keeps the banding |
| Composition on `Background` | The background already owns the only display-bounded geometry, its box, its paint resolution and its panel bake | Region/ramp geometry, CSS mask, canvas mask, ffmpeg graph, editor/MCP authoring | Chosen: one document model, one resolver, every surface reads it |

## Rung 6 — smallest probe

Ran the bundled `ffmpeg-static` binary's filter help and confirmed the options
this graph needs: `gradients` accepts `s`, `c0`–`c7`, `x0/y0/x1/y1` and
`nb_colors` 2–8; `alphamerge` copies the second input's luma into alpha;
`maskedmerge` takes base, overlay and mask; `geq` is a source-capable generic
equation. The spec records an earlier 0→255 linear `gradients` probe. Two
further probes fixed the bake's picture: `gradients` animates by default and its
`speed` floor is `1e-05`, which still moves, so a `loop` on frame zero is the
still source; and an endpoint exactly on the frame's far edge is out of range
and paints the whole ramp wrong, so every generated line is clamped to the last
pixel.

## Decision

Extend `BackgroundMedia` with an optional `composition`: a five-point `anchor`,
an edge band's `extent` and a `fade`. An edge anchor makes a band whose size
along that axis is `extent`; a centre anchor fits the picture's long edge, so
the background's `color` shows in the two opposite gaps and never surrounds the
media. Values outside the model's ranges are refused, never clamped. One pure
resolver in `renderer-core` turns the composition into a box rect and a list of
linear ramps; the DOM layer, the glass sampler and the panel bake all read that
output rather than re-deriving the maths, and all three sample one eased ramp so
the seam has no visible ends. The uncovered area is the board's own `color`
plate, so a paint authored once paints the letterbox, the gaps and the media's
fade. The composition is painted inside the existing
`[data-yunari-background-media]` layer so an overlay capture hides the whole
composition, and on a panel the composition is baked into the 8-bit clip before
the turn. Both device-played families read the same graph: the TURZX's MP4 and
the TUR USB's elementary stream differ in wire geometry, encoder flags and turn,
not in what a composition looks like. A generated `gradients` fill or mask is
held on its first frame, because the source rotates by default and no accepted
`speed` stops it. No mask primitive, no display-space scene object, no separate
overlay tint.
