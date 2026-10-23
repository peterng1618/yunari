# The background layer — design

- **Date:** 2026-10-23
- **Status:** implemented. Plan: [`2026-10-23-background-layer.md`](../plans/archive/2026-10-23-background-layer.md).
- **Related:** [`2026-10-22-theme-versioning-design.md`](2026-10-22-theme-versioning-design.md),
  [`docs/architecture/ownership.md`](../../architecture/ownership.md),
  [`docs/decisions/0093-the-background-is-a-virtual-layer.md`](../../decisions/0093-the-background-is-a-virtual-layer.md),
  [`docs/decisions/0094-the-background-translates-and-mirrors.md`](../../decisions/0094-the-background-translates-and-mirrors.md),
  `schema/theme-document.schema.json`.

## Purpose

The background media stops being a field in the Document pane and becomes a
layer: the bottom-most row of the composition tree, selected like any other
layer, whose properties are the background colour, the media, the box it fills,
its offsets and its two mirrors.

The offsets and mirrors exist for one authoring case: a video whose subject sits
in the centre of the frame, panned so the subject occupies one side of the
artboard and the other side is free for elements. The media is always `cover`,
so it can never be smaller than its box; the layer's bounds — the artboard or
the display — are the clip.

Transform handles are out of scope. The inspector is the only way to change the
media's geometry, and a canvas drag must never select the background.

## Current state

- `renderer-core/src/theme/document.ts` defines `Artboard { width, height,
  contentFit? }` and the top-level `background` section. `BackgroundMedia` is
  `{ assetId, bounds, offsetX?, offsetY?, flipX?, flipY? }`.
- `scene-fabric/src/background-media.ts` mounts the media as a DOM `<div>` below
  the caller's canvas, sized to one of two boxes and clipped by `overflow:
  hidden`. It reports `BackdropMedia` so a glass panel can sample it. Fabric can
  hold a video element through `FabricImage`, but it never repaints it per
  frame; the DOM layer already owns that frame pump, and the layer is also the
  surface glass samples. That is why it stays a DOM sibling.
- `scene-fabric/src/scene.ts` (`SceneArtboard`, `mountFabricScene`,
  `updateArtboard`) and `editor-shell.ts` (`mountMedia`, `placeMedia`,
  `applyArtboardPaint`) mount that layer from artboard state and re-place it
  whenever the camera moves.
- `renderer-core/src/scene/plan.ts` (`planArtboard`) resolves `artboard.background`
  through the palette and carries it as `ScenePlan.artboard.background`.
  `scene-fabric/src/artboard-backdrop.ts` composes the media over that paint for
  glass.
- `editor/src/editor-shell/layer-tree.ts` projects Fabric objects only, and
  `editor-shell/bridge.ts` selection is a list of Fabric objects.
  `selection-inspector/per-kind-column.ts` takes a `FabricObject`.
- `editor/src/panes/document/artboard-fields.tsx` owns the board size beside the
  board; the background's colour, media and geometry live in the inspector.
- `editor/src/editor-document.ts` owns the envelope and `holdsAsset`; the
  artboard plate and host paint are decided in `editor-shell.ts`.
- The schema is decided twice: `renderer-core/src/theme/envelope-keys.ts` is the
  decider, `schema/theme-document.schema.json` the hand-written contract, and
  `fabric-envelope-validate.ts` / `envelope-semantics.ts` enforce it.
  `SUPPORTED_SCHEMA_VERSION` is 2.

## The persisted model

The background becomes a top-level envelope section. It is a layer in the
format, not a node in the Fabric scene:

```ts
{
  artboard: { width: number; height: number; contentFit?: "contain" | "cover" },
  background?: {
    color?: StyleValue,
    media?: {
      assetId: string,
      bounds: "theme" | "display",
      offsetX?: number,
      offsetY?: number,
      flipX?: boolean,
      flipY?: boolean,
    },
  },
}
```

- `artboard.background` and `artboard.backgroundMedia` are removed.
- `background` absent means no colour and no media. The layer row still exists;
  the renderer keeps today's black fallback behind the board.
- `schemaVersion` stays **2**. This is a deliberate exception to the version's
  usual meaning: version 2 no longer identifies a single shape, and an old
  document carrying the removed keys — `fit` and `scale` included — is refused
  by the unknown-key check rather than migrated. The decision note records the
  consequence.

### Semantics

Evaluated in this order:

1. **Bounds** chooses the box: `theme` is the artboard rect, `display` is the
   display rect the renderer already computes — the display screen in the
   editor, the host rect in the player. The box is the clip.
2. **Cover** produces the base media rect: `s = max(box.width / source.width,
   box.height / source.height)`. There is no other fit. The rect is therefore
   never smaller than the box on either axis, and one axis is exactly the box.
3. The base rect is centred in the box.
4. **Offset** asks to pan the centre by a fraction of the box's own dimensions.
   It implies the zoom that pan needs (decision 0095): a pan of `|o|·box` needs
   `|o|·box` of overhang, so the scale is the greater of the cover factor and
   `box·(1 + 2|o|) / source` on each axis, one factor for both so the picture
   never distorts. The pan is bounded by the resulting overhang: the media's
   edge stops on the box's edge, so an offset can never expose colour.
5. **Flip** mirrors the drawn source about the placed rect's centre. It is a
   paint-time transform: the rect, and therefore the no-gap guarantee, is
   unchanged.

Defaults — offsets `0`, flips `false` (i.e. omitted) — reproduce today's centred
cover exactly.

Before the source has an intrinsic size (an image that has not decoded, a video
without metadata) placement is the box and the offsets are ignored, so the load
window has no strip either. The first `load` or `loadedmetadata` re-runs
placement with them.

### Validation

- `offsetX`, `offsetY` finite and `-1 ≤ offset ≤ 1`.
- `flipX`, `flipY` booleans; any other value is refused.
- Out-of-range values are refused, never clamped. (The placement's pan bound is
  rendering, not validation: the authored value stays what the author set.)
- `fit` and `scale` are unknown keys on the media and are refused with
  `unknown-field`; there is no converter and no fallback.
- `color` is a palette reference in both the published schema and the envelope
  validator, exactly as `artboard.background` was; a hand-written literal is
  refused with `unresolved-global-ref`.
- `media.assetId` must resolve to a declared `image`, `svg` or `video`.
- `bounds` is a closed enum; an unknown member is refused.

## Editor surfaces

### The row

`projectLayers` remains a pure Fabric projection. `bridge.layers()` appends one
synthetic row after it, so the background is structurally last and no restack
path can move it:

```ts
BACKGROUND_LAYER_ID = "$background"   // "$" is outside STABLE_ID_PATTERN
```

- `LayerKind`, `LayerMark` and `LayerRole` gain a `background` arm; `uiCopy`
  gains the kind and role words; `icons.ts` gains one glyph.
- Name "Background", depth 0, no parent, no children, `visible: true`,
  `locked: false`, `selected` from the bridge's flag.
- The row has no twisty, no rename, `draggable={false}`, is never a drop anchor,
  and carries no enter, visibility or lock control.
- It is not dimmed when a group is entered: it is always reachable.
- It is not a scene object. `objectCount` in the shell snapshot is unchanged.

### Selection

The bridge holds `backgroundSelected`, mutually exclusive with a Fabric
selection:

- `selectLayer("$background")` discards the active Fabric object and sets it.
- Any `selectLayers` call and any canvas `selection:*` event clears it.
- Shift and Ctrl never mix it into a set; a gesture that would include it
  selects the background alone.
- Canvas drags cannot reach it, because it is not a Fabric object.
- `snapshot().activeKind` gains `"background"` so object actions and tabs are
  ineligible by construction.

### The inspector

`index.ts` branches before `perKindColumn`, which stays Fabric-only:

- The background publishes `subject.kind: "background"`, name "Background", no
  key, `locked: false`.
- `backgroundColumn(background, assets, palette)` returns the same
  `ColumnSectionView` value shape as `perKindColumn`, so `column.tsx` renders it
  unchanged:
  - **Content** — colour (a swatch over palette tokens; the blank reading
    clears) and media (none, or an `image`/`svg`/`video` asset).
  - **Position** — bounds, offset X/Y, and the two flip switches.
  - No Layer or Paint sections.
- Field ids are `background.color`, `background.media`, `background.bounds`,
  `background.offsetX`, `background.offsetY`, `background.flipX`,
  `background.flipY`. They route to the document setter, never to a Fabric
  write. There is no `background.fit` or `background.scale`.
- The blank colour reading removes `color`. The blank media reading removes
  `media`. Choosing a media writes `bounds: "theme"` when none was stored.
- Fractions are stored; offsets display as percentages. `PairHalfView` carries
  `percent?: boolean`; the control shows `value × 100` and commits
  `entered ÷ 100`. A flip is written as `true`, and switching it off removes the
  key (the default is `false`).

### The Document pane

Ratio, orientation, resolution, custom W/H and the size note stay. The colour,
media and fit selects and their commit functions leave `artboard-fields.tsx`;
`DocumentPane` and `ArtboardPanel` lose their `globals` and `assets` props, and
`ArtboardPanel.setGlobals`, `ArtboardPanel.setAssets` and the two callers in
`editor-document.ts` and `editor-session.ts` go with them.

### Session wiring

`EditorDocument` gains `setBackground`, which updates the envelope, marks the
document dirty and calls a new shell `setBackground`. The shell re-paints the
host and plate, updates the media handle and requests a render. `holdsAsset`
and the starter theme read `background.media.assetId`.

## Rendering

### One placement owner

A pure function in `background-media.ts`, used by the DOM layer and by the glass
sampler:

```ts
placement({ box, source, offsetX, offsetY })
  => { left, top, width, height }        // box pixels; may extend outside the box
```

The DOM layer and what a glass panel samples therefore cannot drift. Flip never
enters `placement()`: the DOM child composes `scaleX(-1)`/`scaleY(-1)` into its
own `transform`, and the glass sampler applies the same mirror about the placed
rect's centre before its `drawImage`.

### DOM layer

The layer div is the box: `bounds: theme` is the artboard screen rect,
`bounds: display` is the display screen rect. Its existing `overflow: hidden` is
the clip. The child `<img>`/`<video>` is absolutely positioned from
`placement`; the `object-fit: cover` declaration goes away.

`update()` currently tears down and rebuilds the element on every call, which
would restart a video on every slider tick. The handle gains
`setBackground(background)`:

- remount only when `media.assetId` changes;
- otherwise re-place the same element.
- Bounds, offsets and flips are placement changes, not reloads.

### Colour and plate

`planArtboard` resolves `background.color` through the existing
`resolveStyleValue` path and carries it as `ScenePlan.artboard.background`. The
host style and the artboard plate read that. The plate continues to exist only
when there is no media: the plate is on the canvas above the media layer. Under
`bounds: "theme"` the colour is the letterbox fill around the artboard; with
`cover` the media can no longer leave a gap inside its own box.

### Glass

`backdrop()` keeps reporting the layer box in artboard units. Its paint switches
from the cover-only crop math to the placement rect: the full source is drawn
into the placed destination, offset by `region`, mirrored when a flip is set.
`artboardBackdrop`'s composition — media first, colour underneath — does not
change: with `cover` the colour is only the letterbox around the box.

### Editor and player

- `SceneArtboard` loses `backgroundMedia`; `mountFabricScene` gains a
  `background` option and `updateBackground()` on its handle.
- The player passes `theme.background` and the editor passes the live document's.
- The editor's camera-driven `setBounds` stays the only re-placement path on
  zoom and pan.

## Verification

Focused proof during implementation; the broad gate at the plan boundary.

| Layer | Proof |
|---|---|
| Placement | A table over sources × offsets: cover is centred, an offset zooms to the pan it asks for (0095), and a sweep of boxes, sources and offsets at ±1 never leaves a gap inside the box. The load-window fallback ignores offsets. Pure, no DOM. |
| Handle lifecycle | DOM test: an offset- or flip-only `setBackground` keeps the same `<video>` node; an `assetId` change replaces it. |
| Flip | DOM test: the child carries `scaleX(-1)`/`scaleY(-1)` composed with the other axis, and the rect is unchanged; sampler test: the same mirror around `drawImage`. |
| Validator | Accepts flips and offsets; refuses `offsetX: 2`, a non-boolean flip, and the removed `fit`/`scale` as unknown keys. |
| Schema drift | The existing sync tests are updated for the new root, `$defs` and the removed media keys. |
| Row and selection | Row is last and `$background`; selecting it clears the Fabric selection; `selectLayers` and canvas selection clear it; a shift-range cannot include it. |
| Inspector | `backgroundColumn` enumerates Content and Position (bounds, offsets, flips); the `0.25 ↔ 25` percent mapping; field ids reach `setBackground` and no Fabric write. |
| Visible behaviour | Editor DOM: clicking the row shows the fields, clicking the canvas does not select the background, and the Document pane no longer offers colour/media. Player browser test: the cover placement and the clip are read from measured rects and rendered pixels, one read inside the glass panel; a second case reads the board's edges at a maximum offset, and a third reads a stored `flipX` document through both the DOM layer and the panel. |

## Acceptance

- Clicking the Background row selects it; the inspector shows colour, media,
  bounds, offsets and the two flips.
- Dragging on the canvas never selects the background.
- Panning with the offsets moves the media in the editor within its cover
  overhang; the artboard clips it under `bounds: theme`, the display under
  `bounds: display`.
- Increasing an offset to ±100% never exposes the colour inside the bounds box:
  the placed rect stops at the box's edge.
- A source that has not loaded yet does not expose a strip.
- A theme with none of the new fields renders exactly as before.
- `flipX`/`flipY` is visible in the editor, sampled correctly by a glass panel,
  and survives save/reload.
- A document carrying `fit` or `scale` on its background media is refused as an
  unknown key, with no converter.
- The Document pane no longer offers the background colour or media.

**Observed:** the editor DOM cases drive the row, selection and column; the
player's `background-layer.spec.ts` reads the placed transform from measured
rects and samples the rendered pixels — the board's own interior, the clip above
and below the layer, an edge case at a maximum offset, and one read inside the
glass panel's own rect, so the sampler's answer is checked against the media
behind it. `host-player.spec.ts` covers the real host. The browser cases were
each checked red before its fix (the earlier unit cases written alongside the
plan were characterisations of an existing path, not red-first).

## Non-goals and recorded limitations

- No transform handles or canvas selection for the background.
- No free-colour picker; palette tokens only.
- No shrink, stretch or `contain`: the media is always `cover`. The colour is
  the letterbox fill around the artboard under `bounds: "theme"`, and the
  no-media fill otherwise; it cannot show inside the media's box.
- No scale control and no free pan. An offset zooms the picture only as far as
  the pan it asks for needs, and no further; the pan is bounded by the resulting
  overhang.
- Flips are paint-time only: they mirror the drawn source and never change the
  placed rect, the persisted geometry or the clip.
- No multi-selection with scene layers, no rename, visibility, lock, drag or
  delete for the background row.
- No undo for background edits. Fabric history serialises the scene, and this is
  the same limitation artboard edits already have.
- No converter for the old shape, and none for `fit`/`scale`.
- No second layer type and no generic layer model.

## Risks

1. **Glass parity** — one placement owner plus a test that reads both paths; the
   flip is the same expression applied on both sides, and the browser case reads
   it through the panel.
2. **Undo** — not covered, as recorded above.
3. **Version 2 identifies two shapes** — deliberate; the decision note records
   it.
4. **Video restart** — guarded by `setBackground`'s asset comparison.
5. **Display-bounds offsets** — media may extend outside the display box; the
   display is the clip. Unit tests cover negative and oversized rects.
6. **Implicit zoom** — an offset enlarges the picture (up to 3× at ±100%), so
   repositioning an exactly fitting source crops it. The rect is centred when
   the offset is zero, so the default is unchanged; the zoom is pinned by the
   placement tests and named in decision 0095.
7. **Stored documents and the catalogue** — any document carrying `fit` or
   `scale` is now refused, and the live catalogue's smoke theme predates even
   that shape; it must be reseeded by the owner. This is an external follow-up,
   not a code task.

## Process

- A decision note is required before the first write:
  `renderer-core/src/theme/`, `scene-fabric/background-media.ts`,
  `scene-fabric/scene.ts`, `editor-shell/bridge.ts`,
  `editor-shell/layer-tree.ts` and `selection-inspector/view.ts` are on the
  reuse-gate watchlist. The note carries all seven rungs, including what the
  ecosystem does for a DOM CSS transform versus a canvas `drawImage` mirror.
- Implementation phases, each 3–5 tasks:
  1. Envelope, schema, validator and the fixture sweep.
  2. Placement and the media handle.
  3. Glass and the player.
  4. The layer row and selection.
  5. The inspector, the Document pane and session wiring; evidence and the
     catalogue reseed note close the plan.
- `STATUS.md` currently names no active plan. Selecting this work means the R2
  store plan becomes queued; that is the owner's call at plan time.
