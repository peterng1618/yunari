# 0030 — A panel's overlay leaves the artboard plate transparent

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-raster.ts`

## Problem

A theme with a video background showed the clip on the Lian Li panel only when
the theme declared a transparent background colour. A new theme — which
declares no colour at all — showed black behind its UI, and a still frame of the
previous theme while the new one loaded. The same clip (Wind-Mills) was clean in
the demo theme and black in a fresh theme built from the same asset, so the
difference was the theme's document, not the clip.

## Rung 1 — internal owner

`panel-raster.ts` owns the overlay capture: `setOverlayMode` is the one place
that switches a panel page between "the theme" and "the theme without its
picture". `scene-fabric`'s `scene.ts` owns the artboard paint, and
`applyBoardPlate` puts it on `[data-yunari-artboard-plate]` — a layer of its
own, above the host fill and below the media layer and canvas.

## Rung 2 — installed dependencies

No dependency is involved beyond the DevTools protocol call the rasteriser
already makes; the capture is `Page.captureScreenshot`.

## Rung 3 — native platform

A stylesheet rule with `!important` outranks the plate's inline `background`,
so the clear can be a rule in the overlay stylesheet the mode already injects;
removing the stylesheet restores the inline paint the last `fit()` wrote.

## Rung 4 — public solutions

L-Connect composites its UI as a separate transparent PNG layer over the panel's
own decoder output, which is the same shape as this host's overlay. Nothing in
the vendor's pipeline paints the theme's background into that layer.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Clear only the host fill (previous code) | The host fill is what a `"theme"` media layer covers | The plate carries the same paint as its own layer and stays opaque | Reject |
| Hide the plate entirely | Simple | The plate is also what paints letterbox bars a still needs; hiding it changes the still path too | Reject |
| **Add the plate to the overlay stylesheet as transparent** | **Same mechanism as the disc rule beside it** | None | **Adopt** |
| Force every theme to declare `palette.none` | Works for new themes | The editor would have to write a colour the author did not choose, and an opaque theme would still hide its clip | Reject |

## Rung 6 — smallest probe

Attached 9.2", the real host, a fresh theme built through the host's own save
route whose background is the Wind-Mills clip (known clean in the demo theme):

| Theme document | Overlay PNG | Glass |
|---|---|---|
| No background colour (black plate fallback) | ~102 KB | black behind the clock, no clip |
| With the plate cleared | ~102 KB | Wind-Mills playing under the clock |

The PNG's size did not change, so its size is not a usable signal; the glass
did.

## Decision

`setOverlayMode` adds `[data-yunari-artboard-plate]{background:transparent
!important}` to the overlay stylesheet, beside the disc rule. Leaving the mode
removes the stylesheet, which restores the plate's inline paint — the same
contract the host fill already has.
