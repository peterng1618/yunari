# 0095 — An offset zooms the picture until the pan fits

- **Date:** 2026-10-23
- **Status:** accepted; it supersedes 0094's bounded-pan clause and nothing else
- **Paths:** `src/web/packages/scene-fabric/src/background-media.ts`

## The problem

The background media is `cover`ed over its box and panned by two offsets. The
pan was clamped to the overhang `cover` leaves, so that an offset could never
uncover colour inside the box. That guarantee has a degenerate case: a picture
whose aspect matches the box covers it exactly, leaves no overhang, and every
offset clamps to zero. The starter backdrop is that case by construction — it
is centre-cropped to the artboard's own 1.7768 aspect — so the first picture
every author sees offers two position controls that cannot move it.

Measured at `71f7bf3f`: artboard 1672×941, backdrop 2330×1311, cover rect
1672.06×941.02; overhang 0.03 px across and 0.01 px down, so an offset of
±100% moves the picture by zero pixels.

Repositioning an exactly-fitting picture without exposing a gap requires the
picture to be larger than the box, which is zoom. An explicit zoom control was
removed deliberately (0094), so the zoom has to come from the offset itself.

## Rung 1 — Yunari
Searched: `placement`, `bounded`, `BACKGROUND_MEDIA_DEFAULTS`, the background
column's offset fields, `background-media.placement.test.ts`.
Found: the one placement owner and its tests; the spec's Risks section already
named the inert axis as a limitation. Nothing zoomed.

## Rung 2 — dependencies
Searched: Fabric 7.4 (`Camera` viewport, `object-fit` helpers), and the DOM
media element's own styling.
Found: the media is a DOM sibling below the canvas, not a Fabric object, so
Fabric's camera never sees it; no dependency offers a placement for it.

## Rung 3 — platform
Searched: CSS `object-fit: cover` with `object-position`, and
`background-size: cover` with `background-position`.
Found: both position the replaced content inside its box and cannot overflow
it. With `cover` and a matching aspect the content exactly fills the box, so
there is nothing to position; the platform has the same degenerate case, which
is why the arithmetic lives in our owner rather than in a CSS declaration.

## Rung 4 — ecosystem
Searched: how image croppers let an author reposition a picture that already
fits — Canva's background reposition, Google Photos' crop tool, Unsplash's
editor — and whether any of them pans without changing scale.
Found: none does, because none can: a pan of a fitting picture is a crop
change, so every cropper zooms first and pans the enlarged picture. The
comparison's value is that the zoom is not a feature we are adding but the
thing a pan *is*; the only choice left is whether the author sets it or the
offset implies it.

## Rung 5 — comparison
| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Clamp to overhang (today) | no gap | offsets dead on a fitting picture | the default picture cannot be repositioned | rejected |
| Let the pan expose the gap | no zoom | colour strip inside the box | reverses 0094's guarantee | rejected |
| A separate zoom field | explicit | a third field, and the removed control returns | more state to store and validate | rejected |
| Zoom implied by the offset | no gap, offsets always work | the picture grows while you pan | up to 3× at ±100% on both axes | chosen |

## Rung 6 — probe
Arithmetic, not adjectives. For a box `B` on an axis and an offset `o`, a pan of
`|o|·B` needs an overhang of `|o|·B`, so the placed rect must be at least
`B·(1 + 2|o|)` on that axis. Fed the starter's numbers: an offset of 10%
requires 1.2×, 50% requires 2×, 100% requires 3×; an offset of 10% on the
starter now moves the picture 167 px instead of 0.

## Decision

The placement factor is the greater of the cover factor and, per axis,
`box·(1 + 2|offset|) / source`, with the same single factor on both axes so the
picture never distorts. The pan stays clamped to the overhang, so the no-gap
proof is unchanged and stronger: the rect now always has at least the overhang
the offset asks for. An offset is therefore a crop change that implies its own
zoom — the same thing the croppers in rung 4 do, with the zoom set by the
offset instead of by a second control.
