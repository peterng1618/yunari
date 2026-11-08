# 0029 — An offset pans the picture, never the area

- **Date:** 2026-11-08
- **Status:** accepted; supersedes 0028's offset sentence
- **Paths:** `src/web/packages/renderer-core/src/theme/background-composition.ts`

## Problem

`offsetX`/`offsetY` are authored pan controls. 0028 unifies the media geometry
so scale and offset act on the media *area*: scale grows it about its anchor and
the offset slides it over the box. For an edge anchor the area's own edge **is**
the anchor, so sliding the area detaches the picture from that edge and leaves
the fill showing in between — the reported gap. The same rule also makes an
offset inert at scale 1, where the area equals the box and has no travel.

The integration must keep three things true at once: an edge band stays flush to
its anchored edge, an offset always pans, and no surface derives a second
geometry.

## Rung 1 — internal owner

Searched: CodeGraph on `backgroundGeometry`, `resolveBackgroundComposition`,
`placeMedia`, `visibleArea`; read `renderer-core`, `scene-fabric/background-media.ts`,
`host/panels/panel-video-composition.ts`, `host/themes/theme-media.ts`.

Found: `resolveBackgroundComposition` is the one owner (0028). Its consumers
read `region`, `media.cover`, `media.dest` and `media.crop` only. Prior art for
this exact rule exists in this repo: commit `6420e7c12` (decision 0095) added
`panFloor`, which raised the *cover* factor to `box·(1 + 2|offset|)/source` on
each axis and bounded the pan to the overhang it made; the one-path change
deleted it. `slid()` is the function that produced the gap.

## Rung 2 — installed dependencies

Searched: `fabric` (es build) object transforms and `HtmlImage` in
`scene-fabric`; no geometry donation for authored pan, and Fabric's
`objectCaching`/`cropX` operate per object, not per background composition.

Found: nothing installed owns this rule; the DOM layer is a positioned element
inside an overflow-hidden layer, which is a clip, not a pan model.

## Rung 3 — native platform

Searched: CSS `object-fit`/`object-position` (CSS Images 3), canvas
`drawImage` source-rect form.

Found: `object-fit: cover` + `object-position` behaves as the model now chosen —
the image is scaled to cover, and the position pans within the cover without
ever leaving empty space. CSS offers no way to ask for "inflate until MY pan
fits", so it does not donate the inflation; the glass already draws through
`drawImage`'s source rect, which is the same mapping the resolver now emits.

## Rung 4 — public solutions

Searched: CSS Images 3 `object-position` clamping semantics; Chromium's
`object-fit` implementation notes (clamping so no gap appears); this repo's
decisions 0094/0095 and `src/web/tests/e2e/background-layer.spec.ts`'s
`coveredPlacement` oracle, which already encodes `panFloor` + bounded pan for a
scale-1 box.

Found: the browser rule is "pan only inside the covered area, never expose the
background", and the repo's own e2e oracle independently states the 0095 rule.
Neither solves the two-axis fit (one uniform factor) or the interaction with a
scaled area; both are decided here.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Slide the area (0028) | One rule for all anchors | Opens fill at an anchored edge; inert at scale 1 | Rejected — the reported defect |
| Pan the cover, inflate only when the pan needs it (0095, at area scale) | No gap on any anchor; offsets always pan; area keeps the approved growth-on-scale | None in the owner; tests that encoded the slide must be re-derived | Chosen |
| Always inflate to the maximum offset | Simple | Silently zooms every picture, even offsets of 0.01 | Rejected |
| Refuse offsets below the needed scale | Explicit | Removes an authored control; contradicts "maximize media visibility" | Rejected |

## Rung 6 — smallest probe

Executed: the resolver was run twice on the reported shape (400×100 box, 160×90
source, bottom band, extent 0.5, offsetY −0.5). Before: `region.top` 25 against
a band whose anchored edge is at 50 — a 25px gap. After: `region` identical to
the un-panned band, and `crop.y` 45 against 35 un-panned, i.e. the picture
moved and the band did not. Both readings are now pinned by tests
(`pans the picture inside a band without moving the band off its edge`,
`keeps a top band flush while its picture pans`).

## Decision

`placeMedia` owns the pan: the cover factor is
`max(area/src, (area·(1 + 2|offset|))/src)` per axis (one uniform maximum), the
cover is centred on the area and shifted by `clamp(offset·areaSpan, ±overhang/2)`.
`resolveBackgroundComposition` no longer slides the area, so an edge anchor keeps
its edge; masks stay on the area's edges, so a fade never drifts with a pan.
`scale` keeps meaning "how big the area is" and is not written back when an
offset is set — the pan's inflation is derived, and the e2e oracle
`coveredPlacement` already matches this rule for a scale-1 box.
