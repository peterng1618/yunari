# Background composition — media region, fill and blend

**Status:** approved for planning (2026-11-04)

## Problem

A theme's background media is a single layer clipped to either the artboard
(`bounds: "theme"`) or the screen (`bounds: "display"`), always covering its
box. Every scene object, including a scrim, is painted through the artboard
transform, so it can never extend past the artboard. Two authoring needs fail:

1. **A wide display with a standard-ratio video.** A 16:9 Wallpaper Engine clip
   on a Lian Li panel (an unusually wide screen) is cropped hard at top and
   bottom. The author wants the clip to occupy a region (a side, top or bottom)
   and the rest of the screen to be a palette fill, blended at the seam.
2. **A fade over a contain-fit or full-bleed video.** Agents and authors fake a
   visibility mask with a six-stop dark opacity gradient as a scene rect. On a
   display whose ratio differs the scrim stops at the artboard, so the media
   outside it stays bright; on a TURZX panel the overlay's 4-bit alpha turns the
   ramp into flat grey bands (issue #419).

Both are background composition, not masking or scene layout. The background
already owns the only display-bounded geometry.

## Decision

Extend `Background` with a **region** (where the media sits inside its bounds
box) and a **blend** (how the media fades into the box's fill), plus a
`fill` paint for the media's own backdrop.

- No scene object gains a bounds mode.
- No mask primitive, no display-space layer, no second paint layer over the
  media. The fade is the media's alpha ramp, so it inherits `bounds` and is
  display-bounded by construction.
- The colour a fade reveals is `background.fill` (or `background.color` when
  `fill` is absent). A "darken map" is a blend on one edge with no inset.
- On TURZX the composition is baked into the panel clip with ffmpeg, in the
  8-bit video plane, so the blend never enters the 4-bit UI overlay.

## Evidence

- `renderer-core/src/theme/document.ts` — `Background` (`color`, `media`),
  `BackgroundMedia` (`assetId`, `bounds`, `offsetX/Y`, `scale`, `flipX/Y`,
  `fallbackFrame`). `bounds` is the only display-vs-artboard switch.
- `scene-fabric/src/background-media.ts` — the media layer is the bounds box;
  `placement()` covers the box and bounds the pan/zoom so the box cannot be
  exposed. The layer is `[data-yunari-background-media]`.
- `host/src/panels/panel-raster.ts:setOverlayMode` — the overlay capture hides
  `[data-yunari-background-media]` and makes the plate transparent, so every
  background pixel on a TURZX clip panel must come from the baked clip.
- `host/src/panels/turzx-video.ts` — the bake crops/scales the source into the
  panel box and turns it; ffmpeg-static is 6.1.1 and has `gradients` (probed:
  linear 0→255 ramp), `geq`, `maskedmerge`, `alphamerge`, `color`, `gblur`.
- `docs/hardware/turzx-serial.md` — the overlay carries 4 bits per channel and
  4 bits of alpha; the video plane does not.
- `scene-fabric/src/artboard-backdrop.ts` and `background-media.ts:backdrop()`
  — the glass sampler paints the media itself; it must see the composition.
- `docs/decisions/0027-lian-li-clip-is-paced-to-its-playing-time.md` — the
  panel clip is already an authored-transform bake, so the composition extends
  that seam.

## Model

```ts
export const BACKGROUND_EDGES = ["left", "right", "top", "bottom"] as const;
export type BackgroundEdge = (typeof BACKGROUND_EDGES)[number];

export type BackgroundBlend =
  | { readonly shape: "linear"; readonly edge: BackgroundEdge; readonly length: number }
  | { readonly shape: "radial"; readonly length: number };

export interface BackgroundRegion {
  /** Fractions of the bounds box; absent means 0. */
  readonly left?: number;
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  /** Absent means a hard region edge. */
  readonly blend?: BackgroundBlend;
}

export interface BackgroundMedia {
  // …existing fields
  readonly region?: BackgroundRegion;
}

export interface Background {
  readonly color?: StyleValue;
  readonly fill?: StyleValue;
  readonly media?: BackgroundMedia;
}
```

Rules:

- Insets are fractions in `[0, 0.9]`; each axis must sum to less than 1, so the
  region always has positive area. Refused, never clamped.
- `blend.length` is a fraction of the box's dimension along the ramp
  (`left`/`right` use width, `top`/`bottom` use height; `radial` uses the
  smaller half-extent of the region), in `(0, 1]`.
- `linear` requires `edge` and refuses none; `radial` refuses `edge`.
- `region` is absent by default → the current full-cover behaviour.
- `fill` is a paint like `color`; absent means `color` is the fill. Painted
  only inside the media's bounds box, behind the media.
- The media still uses cover/pan/zoom, bounded by **its region** instead of the
  whole box.
- Region and blend are authored in the media's bounds box, which is the turned
  box on a quarter-turned mount, exactly as `placement` already is.

### Ramp direction

The media is opaque inside the region and transparent at a blended edge:

- `left`: opacity 0 at the region's left edge, 1 at `left + length·box.width`.
- `right`, `top`, `bottom`: mirrored.
- `radial`: 1 inside `(1 − length)` of the way from the region centre to its
  boundary, 0 at the boundary. The ramp is an ellipse fitted to the region.

A ramp longer than the region caps at the opposite edge.

## Pure resolver

`renderer-core/src/theme/background-composition.ts` decides the geometry once:

```ts
export interface BackgroundComposition {
  readonly region: { left; top; width; height };      // box pixels
  readonly mask:
    | { readonly kind: "linear"; x1; y1; x2; y2 }     // canvas/CSS gradient line
    | { readonly kind: "radial"; cx; cy; rx; ry; opaqueFraction: number }
    | undefined;
}

export function resolveBackgroundComposition(
  box: { readonly width: number; readonly height: number },
  region: BackgroundRegion | undefined,
): BackgroundComposition;
```

Every surface consumes this: CSS mask, canvas backdrop, ffmpeg mask. No surface
re-derives the inset maths.

## Surfaces

### Player / editor DOM (`scene-fabric`)

- The media layer (`[data-yunari-background-media]`) stays the bounds box and
  the clip.
- Inside it, in order:
  1. a fill layer covering the box, painted with `cssArtboardPaint(fill)`;
  2. a region wrapper positioned by `resolveBackgroundComposition`;
  3. the media child, placed with `placement()` against the **region** box.
- The wrapper carries the mask: `mask-image`/`-webkit-mask-image` with
  `linear-gradient(<edge>)` or `radial-gradient(...)`, `mask-size: 100% 100%`.
- **The fill layer is inside the media layer.** `setOverlayMode` hides that
  layer for a TURZX overlay; a fill outside it would paint over the device's
  clip.
- The fill is not a scene object: it does not enter the layer tree, selection
  or hit-testing. It is background composition.

### Glass sampling (`scene-fabric` backdrop)

`BackdropMedia` gains the resolved fill paint and the mask spec. A glass panel
samples the composition it can see: fill first, then the media clipped to the
region and masked, in the same geometry the DOM layer uses. A panel must not
sample an unmasked full-bleed video.

Implementation guidance: render the masked media into a scratch canvas sized to
the region and draw that, rather than leaving `destination-in` on a shared
backdrop context.

### Panel bake (`host`)

`PanelVideoPlacement` gains `region`, `blend`, `fill` (resolved paint) and the
existing pan. The bake, in the turned box:

1. crop the source to the cover of the **region** box (`panelCrop` against the
   region size), scale to the region's pixel size;
2. render the fill across the whole box: `color` for a solid, `gradients` for a
   linear gradient (≤ 8 stops);
3. render the mask: `gradients` for a linear ramp, `geq` for radial;
4. composite the scaled video over the fill with the mask (`maskedmerge` or
   `overlay` with the mask as alpha);
5. apply the existing turn/pad suffix.

`encodeArgs` takes `-filter_complex` + `-map` when a composition exists; the
plain `-vf` path remains for a theme with no region, blend or fill. The cache
key and `TRANSCODE_VERSION` include the composition.

The overlay capture is unchanged: the clip already carries the composition and
the page's background layer is hidden.

### Panel preview

`servePanelPreview` photographs the player page, which renders the DOM
composition, so preview and device share one model. The preview is the page
composition, not the baked file; that is accepted because the model is the
same. A region whose fill is a palette gradient must resolve identically in
both paths (same paint, same angle convention).

### Authoring

**MCP** `set_background` gains:

- `fill?: string | PalettePaint`
- `inset?: { left?; top?; right?; bottom? }`
- `blend?: { shape?: "linear" | "radial"; edge?: BackgroundEdge; length: number }`

The tool refuses values the validator would refuse (range, missing edge) so a
draft does not carry an invalid background between calls.

**Editor** background inspector gains a "Composition" section, shown with the
media, using existing controls (`DESIGN.md`):

- fill swatch (palette token; blank = `color`);
- media placement segmented: full / left / right / top / bottom / inset;
- placement amount slider (percent, 0–90);
- blend edges select: none / left / right / top / bottom / all;
- blend length slider (percent, 1–50);
- blend shape segmented: linear / radial.

The `bounds` row continues to choose the box; the composition is expressed in
that box.

## Non-goals (recorded so they are not re-litigated)

- A fill sampled or blurred from a video frame. It is a derived paint; if added,
  it must persist the derivation parameters and be static across surfaces.
- A tint layer above the media that is not the background paint. A blend fades
  to `fill`; a different-colour tint is a separate feature.
- Per-object masks, display-space scene objects, or multiple disjoint media
  regions.
- A pixel-space blend easing: the ramp is linear through the blend length.

## Compatibility

Additive optional keys inside schema `2.0.0`; no migration. An older reader
ignores `fill`/`region` and renders the theme with full-cover media. The
validator's key bags and the published schema change together; the drift test
holds them equal.

## Verification

- Validator: refuses each range/shape violation; accepts a full composition and
  keeps it on round-trip.
- Resolver: region and mask geometry for each edge, radial, and no-region.
- DOM: layer boxes, fill paint, mask string, and the media layer still owns the
  fill (overlay-mode test hides it).
- Glass: a panel samples fill + masked media, not the raw media.
- Bake: filter graph for solid and gradient fills, linear and radial masks;
  no-composition themes keep the `-vf` path; cache key changes with the
  composition.
- MCP: set_background round-trips the new fields and refuses invalid ones.
- Editor: fields project and write; the column ids reach the document.
- `npm run gate` exits 0.
- Manual: an Lian Li-ratio browser preview and a TURZX panel show the same
  region/seam, and a contain-fit fade is display-bounded.

## Open risks

- Radial masking in ffmpeg via `geq` costs CPU; a 20 s panel clip is the budget
  to measure. If it is too slow, pre-render the mask as one PNG per encode.
- CSS `mask-image` support is Chromium-first; the product's panels already
  require a Chromium-family browser.
- The fill paint and the letterbox paint can be different colours; that is
  intentional (fill is inside the media box, colour is the screen/board), but
  docs must say which one an author is setting.
