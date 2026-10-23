# 0093 — The background is a virtual layer, not a scene object

- **Date:** 2026-10-23
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/`, `src/web/packages/renderer-core/src/theme/document.ts`, `src/web/packages/renderer-core/src/theme/envelope-keys.ts`, `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`, `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`, `src/web/packages/scene-fabric/src/background-media.ts`, `src/web/packages/scene-fabric/src/scene.ts`, `src/web/packages/editor/src/editor-shell/bridge.ts`, `src/web/packages/editor/src/editor-shell/layer-tree.ts`, `src/web/packages/editor/src/selection-inspector/view.ts`, `src/web/packages/editor/src/editor-session.ts`

## The problem

The background must become a **layer** in the editor: the bottom row of the
composition, selectable like any other row, whose inspector edits its colour,
its media, and the media's bounds, fit, scale and offsets. Today it is two
artboard fields — `artboard.background` and
`artboard.backgroundMedia: { assetId, fit: "theme" | "display" }` — with no row,
no selection and no geometry.

The shape is non-obvious in five places:

1. **A video cannot be a scene object without a frame pump.** Fabric has no
   self-updating video; every canvas implementation in rung 4 still writes its
   own per-frame redraw loop.
2. **The fit geometry is computed twice.** The DOM layer is drawn by CSS; the
   glass sampler draws the same media into a canvas. CSS `object-fit` does not
   publish the rect it produced, so the two consumers must share one placement
   function or they drift.
3. **A scene object would be a second copy of authored state.** The envelope
   already owns the media reference. Putting it in the Fabric scene as well
   makes it persist twice, appear in `serialiseScene` and history, count in the
   object census, and be draggable, deletable and restackable — each of which
   would need its own exception.
4. **The row must be structurally last.** Not merely painted first: no restack,
   drop, drag, rename, hide or delete can be allowed to move it.
5. **`schemaVersion` does not move.** The change removes keys from a version 2
   envelope, so version 2 would otherwise identify two shapes.

## Rung 1 — Yunari

Searched: `background-media.ts`, `scene.ts`, `artboard-backdrop.ts`, `glass.ts`,
`editor-shell.ts`, `layer-tree.ts`, `bridge.ts`, the whole
`selection-inspector/` directory, `theme/document.ts`, `envelope-keys.ts`,
`fabric-envelope-validate.ts`, and `SUPPORTED_SCHEMA_VERSION`.

Found: the rendering pipeline exists and is already DOM-based; nothing behind
the polish — row, selection, inspector, scale/offset, shared placement — exists.

- `theme/document.ts` declares `Artboard { width, height, background?,
  contentFit?, backgroundMedia? }` and
  `BackgroundMedia { assetId, fit: "theme" | "display" }`. `StyleValue` is the
  colour vocabulary; there is no scale or offset anywhere.
- `background-media.ts` prepends a DOM `<div>` to the host, gives it
  `position:absolute; inset:0; overflow:hidden` and sizes it to one of two
  boxes. Its child `<img>`/`<video>` is `width/height:100%; object-fit:cover`.
  `update()` stops and rebuilds the element on **every** call — a slider tick
  would restart a video. `backdrop()` returns the layer rect in artboard units
  and paints through `mediaDrawArgs`, which reproduces centred cover only.
- `scene.ts` (`SceneArtboard`, `mountFabricScene`) mounts that handle once,
  wires `artboardBackdrop({ background, media })`, re-places on `fit()`, and
  forwards artboard changes through `updateArtboard`. It cannot carry a
  document-level paint in the plan; the paint is resolved before it arrives.
- `glass.ts` defines `BackdropMedia { rect, paint(ctx, region, device) }` and
  keeps a separate backdrop surface per panel because the media is a DOM
  sibling the canvas cannot see.
- `editor-shell.ts` has a second mount of the same handle (`mountMedia`),
  its own `placeMedia` driven by `viewport.artboardScreenRect()` /
  `displayScreenRect()`, its own plate, and its own host paint. Three consumers
  of one placement is the reason parity is a risk.
- `layer-tree.ts`'s `projectLayers` walks Fabric objects only; `LayerKind`,
  `LayerMark` and `LayerRole` are closed unions with no background arm.
- `bridge.ts` selection is a set of Fabric objects (`selectLayer`,
  `selectLayers`); a non-Fabric row has no way to be selected.
- `selection-inspector/view.ts`'s `SubjectView.kind` is `SelectionKind`, owned
  by `per-kind-column.ts`, which takes a `FabricObject`.
- The envelope refuses unknown keys (`unknownKeys`, `fabric-envelope-validate.ts`)
  and `SUPPORTED_SCHEMA_VERSION` is `2` (`fabric-envelope.ts`). `envelope-keys.ts`
  lists `background` and `backgroundMedia` as artboard keys, so removing them
  from the type without removing them from this decider would make the schema
  drift test fail first.

## Rung 2 — dependencies

Searched: every `src/web/packages/*/package.json`, and Fabric 7.4.0's
`dist/src/shapes/Image.d.ts` and `src/shapes/Image.ts`.

Found: one renderer dependency, `fabric: 7.4.0`, in `scene-fabric` only; no
Konva, Pixi, or image-fit package in the workspace. Fabric 7.4 **does** accept a
video: `export type ImageSource = HTMLImageElement | HTMLVideoElement |
HTMLCanvasElement`, and `FabricImage.setElement()` takes one, so "video cannot
be a Fabric object" is false as a platform claim.

What Fabric does not give is the lifecycle that would make it the right one:
`Image.ts` has no `requestVideoFrameCallback` subscription and no repaint pump,
so a `FabricImage` over a `<video>` still needs our own frame loop. What it
would add is scene-graph membership — serialisation, history, object census,
selection, restack — which is the second-copy problem, not a feature.

No installed dependency computes CSS `object-fit` geometry for a canvas; that
gap is rung 3 and rung 4's consistent finding.

## Rung 3 — platform

Searched: CSS `object-fit` / `object-position` (CSS Images 3), `overflow:
hidden`, `clip-path`, `transform`; canvas `drawImage`; `HTMLVideoElement`'s
`requestVideoFrameCallback`, `loadedmetadata`, `videoWidth`/`videoHeight`.

Found: the platform supplies the primitives and the events, and withholds
exactly the piece that has two consumers.

- `object-fit: cover|contain|fill` implements the fit formulas directly and
  `object-position` defaults to `50% 50%`, so the browser centres the media.
  But **the resulting content rect is not exposed**: `getBoundingClientRect()`
  returns the element's box, not the painted image's. Script cannot read the
  geometry the browser used, and the glass sampler cannot borrow it.
- `overflow: hidden` on the box is the clip. `clip-path` adds shape, which the
  background does not need.
- `drawImage` has no `object-fit`. It takes source and destination rectangles,
  so the canvas side must derive the same rect independently.
- `loadedmetadata` then `videoWidth`/`videoHeight` give the intrinsic size (0
  before metadata); `HTMLImageElement.naturalWidth` is 0 until decode.
  `requestVideoFrameCallback` fires once per presented frame and is the
  correctly-shaped event for repainting the glass. An absent or not-yet-decoded
  source has no fit, so placement must fall back to the box until one of these
  lands.

## Rung 4 — ecosystem

Searched (Exa, live):

- `Fabric.js video background canvas FabricImage HTMLVideoElement`
- `Konva video layer background stage video element React Konva`
- `object-fit cover canvas drawImage source crop formula`
- `design editor background layer bottom Figma Canva background`

Found: nobody solves "transformable background media shared by a DOM layer and
a canvas sampler"; the pieces around it are solved, and consistently.

- **Fabric** — its own demo (`fabricjs.com/demos/video-element`) mounts a video
  as a `FabricImage` source and says "Fabric.js does not support a FabricVideo
  class per se, nor does it support video export directly". Issue #6164 (video
  as background): the element
  rendered at zero height until dimensions arrived, and had to wait for load;
  a StackOverflow answer (#77392370) implements a bespoke `fabric.Object` whose
  `render` calls `drawImage(video, …)` and pumps `requestAnimationFrame` (or
  overrides `_renderBackground`). Every answer writes the frame loop; none
  avoids it.
- **Konva** — its official "How to display video on Canvas"
  (`konvajs.org/docs/sandbox/Video_On_Canvas.html`) sources a `Konva.Image` from
  a `<video>` and then redraws the layer continuously with
  `Konva.Animation` (or rAF + `layer.draw()`), stops the animation on pause, and
  reads `loadedmetadata` for dimensions. A maintainer answer states Konva is not
  designed for video, and that managing a playing video directly in the DOM is
  simpler than drawing it into the canvas.
- **object-fit on canvas** — no native bridge exists. The recurring answer is a
  hand-rolled crop ("Simulation background-size: cover in canvas"), and the
  most complete implementation found, `html2canvas-pro`'s
  `calculateObjectFitRendering`, returns `sx/sy/sw/sh` plus `dx/dy/dw/dh` — the
  same placement this note names, derived by the consumer because the browser
  exposes none.
- **Design editors** — Canva's layers panel pins the background to the very
  bottom: it cannot be moved and no layer may go below it, but it can be
  selected and its colour changed, and Canva accepts images and videos as
  backgrounds with reposition/resize. Figma documents the background as a
  page/frame fill rather than a layer row. The requested shape matches Canva:
  a pinned, select-only bottom row backed by a document section.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep `artboard.background` / `backgroundMedia`, extend the existing DOM layer | Renderer only | Smallest | No row, no selection, no inspector; the background stays a property, which the requirement rejects | Rejected |
| Put the background in the Fabric scene (`FabricImage` or custom object) | Selection, row and restack come free | A scene object, a frame pump, and exception paths through serialise, history, census, drag, delete, drop | Authored state exists twice; every scene operation must learn to exclude it; a video still needs our own rAF/rVFC loop (rung 4); glass work already depends on the DOM sibling | Rejected |
| A custom Fabric object that draws the video each frame | Renderer only | Vendor-shaped code plus a pump | Same second-copy and selection problems, plus bespoke class registry and persistence | Rejected |
| **A new `background` envelope section rendered by the existing DOM layer, with one pure placement function shared with the glass sampler** | Exact | One synthetic row, one selection flag, one inspector column, one placement function | DOM/glass parity (closed by one owner plus a test); version 2 identifies two shapes (recorded in Decision) | **Chosen** |

## Rung 6 — probe

Measured with a throwaway Playwright/Chromium page
(`C:\tmp\yunari-bg-probe-0093\probe.mjs`, not committed). Source: a 100×100
canvas, transparent except an opaque red square at source (40,40)–(60,60). Box:
200×100. For each of `cover`, `contain`, `fill`, an `<img>` with
`width:200px;height:100px;object-fit:<fit>` was rendered, the box was
screenshotted, and the PNG was decoded back through the browser's own canvas
to bound the red pixels. Those bounds were compared with the placement formula
(`s = max/min/axis` scale, centred, clipped to the box) and with a canvas
`drawImage` of the same source into the placement's destination rectangle.

| fit | placement (left, top, width, height) | red bounds from formula | DOM painted (measured) | `drawImage` destination (measured) |
|---|---|---|---|---|
| cover | 0, −50, 200, 200 | x 80–120, y 30–70 | x 80–120, y 30–70 | x 79–121, y 29–71 |
| contain | 50, 0, 100, 100 | x 90–110, y 40–60 | x 90–110, y 40–60 | x 90–110, y 40–60 |
| fill | 0, 0, 200, 100 | x 80–120, y 40–60 | x 80–120, y 40–60 | x 79–121, y 40–60 |

The DOM result matches the computed placement **exactly, on every fit**. The
`drawImage` result matches within one device pixel on the scaled axis only;
the extra edge pixel is the scaler's interpolation of a source edge that lands
on a pixel boundary, captured by the probe's "any non-zero alpha is red"
threshold, not a difference in geometry. Smoothing quality is not part of this
decision; the geometry is.

## Rung 7 — build

Build the virtual layer: a `background { color?, media { assetId, bounds, fit,
scale, offsetX, offsetY } }` envelope section, rendered by the existing DOM
layer and projected into the UI as one synthetic row.

- The layer div is the box. `bounds: theme` is the artboard screen rect,
  `bounds: display` is the display screen rect; `overflow: hidden` is the clip,
  so an offset that pushes the media outside the box shows the colour.
- One pure `placement({ box, source, fit, scale, offsetX, offsetY })` returns
  the destination rect in box pixels. The DOM child is positioned from it; the
  glass sampler paints into the same rect; neither can drift.
- The child is remounted only when `assetId` changes. Fit, bounds, scale and
  offsets re-place the same element, so a scale-slider tick does not restart a
  video. Placement falls back to the box until `load`/`loadedmetadata` supplies
  an intrinsic size, then re-runs.
- The plan resolves `background.color` through the existing `StyleValue` path,
  so the host paint and the artboard plate keep one owner.
- The row is synthetic and structurally last (`$background`, outside
  `STABLE_ID_PATTERN`); the bridge holds a mutually exclusive
  `backgroundSelected` flag; the inspector branches before `perKindColumn` and
  never writes Fabric. The background never enters `canvas.getObjects()`,
  `serialiseScene`, the object census or history.

The reason is not "the DOM layer already exists" — an existing implementation is
not a decision. It is that **the authored state has exactly one owner, and the
placement has exactly one owner**. A scene object buys selection machinery we
would then have to disable in five places and still leaves the video frame loop
to us; a DOM layer plus a pure placement function keeps the envelope as the only
persisted copy, the row as an explicit projection rather than a scene
side-effect, and the two renderers sampling one rect.

## Decision

**The background becomes a top-level envelope section and a virtual layer.**

```ts
background?: {
  color?: StyleValue,
  media?: {
    assetId: string,
    bounds: "theme" | "display",
    fit?: "cover" | "contain" | "fill",
    scale?: number,
    offsetX?: number,
    offsetY?: number,
  },
}
```

`artboard.background` and `artboard.backgroundMedia` are removed. Defaults —
`fit: "cover"`, `scale: 1`, offsets `0` — reproduce today's centred cover
exactly (rung 6 measured it). `scale` is refused outside `0.1–10` and offsets
outside `-1–1`; out-of-range values are errors, never clamped.

**`schemaVersion` stays `2`.** This is deliberate: version 2 no longer
identifies a single shape. A document carrying the removed
`artboard.background` / `artboard.backgroundMedia` keys is **refused** by the
unknown-key check (`unknown-field`), not migrated — there is no converter, no
fallback, and no dual read. The consequence is recorded and accepted: an old
version 2 document is unreadable by this build until its owner rewrites it, and
the live catalogue's smoke theme, which carries the old shape, must be reseeded
by its owner. That reseed is an external follow-up, not a code task.

The colour keeps the existing `StyleValue` rules: a reference must resolve to a
declared palette token; a literal is refused by the envelope validator, as it
was for `artboard.background`. `media.assetId` must resolve to
a declared `image`, `svg` or `video`. `fit` and `bounds` are closed enums.

The row, the selection flag and the inspector column are projections of this
one section. The media layer, the glass sampler and the plan's paint read it;
nothing writes back to it from the scene.
