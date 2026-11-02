# 0089 — export and publish bake crops; flips rewrite their source

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/persist.ts`, `src/web/packages/scene-fabric/src/object-crop.ts`, `src/web/packages/editor/src/editor-document.ts`, `src/web/packages/editor/src/editor-session-actions.ts`, `src/web/packages/editor/src/crop-manager/bake-stored.ts`, `src/web/packages/editor/src/crop-manager/encode-png.ts`, `src/web/packages/editor/src/components/output-bake-dialog.tsx`, `src/web/packages/editor/src/store-mode/use-submit.ts`, `src/web/packages/editor/src/store-mode/region.tsx`, `src/web/packages/editor/src/flip-selection.ts`, `src/web/packages/editor/src/editor-shell/bridge.ts`, `src/web/packages/editor/src/editor-shell/shell-layout.tsx`, `src/web/packages/editor/src/selection-inspector/view.ts`

## Problem

A crop is a Fabric `clipPath` and a flip is a Fabric `flipX`/`flipY` flag. Both
hide or mirror part of a source image while the persisted asset still carries
every pixel, and the flag itself travels in the scene. A theme package or a
store submission therefore serves pixels the author meant to remove, and a theme
document has to transport an orientation that only the image file needs to
know. The fix must remove both forms at the moment bytes leave the editor or
the host, without changing what the author sees on the canvas.

The library and a display assignment are not output boundaries: they must keep
the live crop so it stays editable.

## Rung 1 — internal owner

`crop-manager` owns the transient frame and the committed clip; `AssetManager`
owns declarations, bytes, preview URLs and digests; `editor-document` owns the
package download, release and widget export paths; the store region owns the
submission press. None of them owned "make the authored result the exported
result". One browser pass plans against the serialised envelope and the asset
map, so the live document is never mutated. `serialiseScene` remains the only
scene writer, and the marker is added to its persisted list rather than a second
scene model.

## Rung 2 — installed dependencies

Fabric donates `clipPath`, `calcTransformMatrix`, `getRelativeCenterPoint`,
`Path.path`/`Polygon.points`, `setBoundingBox`, and `FabricImage.setElement`.
`toDataURL` encodes the cropped canvas. Fabric does not bake clips or mirrors
into source pixels; that is the missing integration. No image codec is added:
the browser already decodes every format the editor accepts, and the host serves
video through FFmpeg but never crops a picture.

## Rung 3 — native platform

Canvas 2D `drawImage`/`scale`/`translate` produce the mirrored and cropped
pixels; `crypto.subtle.digest` gives the declaration's SHA-256. Neither chooses
when to bake or which assets may be dropped.

## Rung 4 — public solutions

Image editors keep crop and flip as live view state while editing and apply
them when exporting; export formats that embedded a source plus a clip would
leak the hidden region. The pattern is the same here: keep the live gesture,
bake at the output boundary. No external library can own this because the
output is Yunari's theme package and its declaration list.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Bake a serialised copy at the output boundary | Keeps crops editable in the library; every download and store upload loses the hidden pixels | The store temporarily saves that copy, then writes the original back | Chosen |
| Bake the live canvas, then save | One code path | Mutates the document, drops the author's source and restarts history; the user's explicit refusal | Rejected |
| Bake before every library save/assignment | Simplest single call site | Destroys hidden pixels the author still needs to re-crop | Rejected |
| Persist a clip/flip and trust the player | Leaks hidden pixels and keeps carrying orientation | None; rejected | Rejected |
| Rewrite the source asset in place | Simple for one object | Breaks a second object showing the whole picture, and undo cannot replay the old bytes | Rejected |
| A parallel "export scene" tree | Keeps the document untouched | A second scene model and a second asset map | Rejected |

## Rung 6 — smallest probe

`crop-manager/bake-stored.dom.test.ts` crops an asset-referenced image from a
serialised envelope, bakes it, and reads the object's clip, size, declaration
and bytes; it also keeps the source when a second object still shows it whole.
`flip-selection.dom.test.ts` mirrors an image, a path and a polygon and reads the
rewritten bytes, commands and points. `widget-export.dom.test.ts` drives the
async export path.

## Decision

- `yunariCrop` marks an author crop, so a layout cover-clip is not mistaken for
  one; the marker is authored state and persists.
- `bakeStoredThemeCrops` encodes the visible source rectangle to PNG, declares a
  fresh asset (`assets/<name>-crop.png`), re-points the object, clears the clip
  and the marker, and drops the old declaration when nothing else references
  it. It plans every image before decoding any, and returns the copy instead of
  mutating the document.
- `downloadPackage`, `release` and `exportWidget` pass their serialised copy
  through that function. Saving to the library and assigning a theme to a
  display do not: both keep the live clip and the source bytes.
- An export or publish with at least one authored crop asks before writing. The
  warning names the flattened crops and the source files left out; cancelling
  writes nothing.
- Online publishing reads the stored theme, bakes that copy in the browser,
  confirms, writes the baked copy so the host packages it, then writes the
  original content back when the submission ends. The local library therefore
  keeps the source and the live crop. The open document's stored base is reset
  to "carry every declaration" for its next save.
- The toolbar's two flip actions rewrite pixels (images) or path data
  (`Path`, `Polygon`) and clear Fabric's flags. They are offered only to one
  unlocked picture or path-like shape: rectangles, circles, ellipses, charts,
  groups and multi-selections are not subjects.
- Background media flips remain paint-time envelope state; they are not part of
  this bake.
- A flip keeps the previous derived asset for undo; no export path mutates the
  document or restarts history.
