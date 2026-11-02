# 0087 — background media scale rides the placement owner

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/document.ts`, `src/web/packages/scene-fabric/src/background-media.ts`, `src/web/packages/editor/src/selection-inspector/background-column.ts`

## Problem

The background media is always `cover`, with offsets but no zoom. An author who
wants to frame a detail can pan but cannot enlarge the picture, and the old
`scale` key was removed when fit went away — so the control has to come back
without reintroducing a second placement path.

## Rung 1 — internal owner

`placement()` in `scene-fabric/src/background-media.ts` is the one owner: the
DOM layer and the glass sampler both size the picture through it. The document
model owns the stored value (`BackgroundMedia` in `renderer-core`), and the
editor column already projects its offsets from that model. Extending these
three is one owner per concept; a new zoom adapter would be a parallel path.

## Rung 2 — installed dependencies

Searched Fabric's image scaling and CSS `object-fit`/`transform`. Neither owns
the pan bounds: the no-gap proof is Yunari's placement rule, and a CSS zoom
would leave the glass sampler reading a different rect. No dependency donates
the composition.

## Rung 3 — native platform

CSS `transform: scale()` can enlarge the DOM child, but the glass sampler draws
from `placement()` onto a canvas and would disagree. The browser offers no
shared source for both paints.

## Rung 4 — public solutions

Comparable media layers (map tiles, wallpaper croppers) store a zoom factor and
multiply the cover factor, then bound the pan against the enlarged rect. That is
the same shape as the existing offset floor, so no library is needed.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Multiply `placement()`'s factor by a stored zoom | Both painters share the result; pan bounds already derive from the rect | None | Chosen |
| CSS transform on the child | DOM only; glass sampler diverges | Second geometry path | Rejected |
| Bake zoom into the image element's width/height | Same divergence, and offsets read the wrong base | Rejected |
| New placement module | Duplicates the cover/pan proof | Rejected |

## Rung 6 — smallest probe

`background-media.placement.test.ts` already pins cover, pan floors and the
no-gap sweep. Added cases for a doubled factor and for out-of-range values being
bounded; no browser probe was needed.

## Decision

`BackgroundMedia.scale` is a fraction from 1 to 5, absent meaning 1; the
validator refuses outside that range and the published schema states it.
`placement()` multiplies its cover/pan factor by the bounded value and both
callers pass it. The editor shows it as a 100–500% slider whose track is the
model's range, so the control cannot produce a refused value.
