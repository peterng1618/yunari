# 0088 — crop previews through the session's own frame

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/crop-manager/index.ts`

## Problem

Resizing the crop frame changed the selection box but left the whole picture
painted underneath it; the clip appeared only after Apply. Cropping an image
that already had a crop also started from the full bounds, so the discarded
pixels were offered again. Flips added in the same change make the image's
scale negative, which the old crop math refused outright.

## Rung 1 — internal owner

`crop-manager` owns the frame, the transient clip and the undo boundary; the
selection inspector only projects its state. Fabric's own clipPath is the
persisted representation and the scene adapter already serialises it, so the
live preview is the same clip written during the gesture rather than a second
scene tree.

## Rung 2 — installed dependencies

Fabric offers `clipPath` and object gesture events (`moving`, `scaling`,
`modified`). It does not give a cropped object a clipped bounding box, so
replacing clipPath with `cropX/cropY` would change the stored representation and
break existing documents; that was rejected.

## Rung 3 — native platform

Canvas 2D clipping is what Fabric's clipPath already compiles to. No platform
API adds live preview.

## Rung 4 — public solutions

Image croppers preview by applying the pending rectangle to the picture during
the drag and committing it on release. The shape matches Fabric's event model.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Mutate one preview `Rect` on the image during frame events | Same persisted clip; Apply keeps it; Cancel restores the prior clip | None | Chosen |
| Recompute only on Apply | No live feedback; the reported defect | Rejected |
| `cropX/cropY`/`width`/`height` | Changes the persisted model and every existing crop | Rejected |
| A second preview overlay layer | Duplicates what the clip already draws | Rejected |

## Rung 6 — smallest probe

`crop.dom.test.ts` fires Fabric's `modified` event and reads the live clip's
size, then cancels and reads the restored clip. A re-crop case starts a second
session from the visible bounds. The flipped-image case applies a crop with
`scaleX = -1` and reads a positive clip width.

## Decision

The session keeps the clip before it started, writes one reusable preview `Rect`
in image-local units as the frame moves, and keeps that clip on Apply. Cancel
restores the prior clip. `begin` frames the visible bounds (the prior crop's
scene rect) instead of the full image. `cropClipRect` uses the signed scale for
the centre offset and its magnitude for size, so a flipped image crops rather
than throwing.
