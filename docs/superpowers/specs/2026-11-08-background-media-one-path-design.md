# Background media — one geometry path

**Status:** approved for planning (2026-11-08)

## Problem

Background media geometry has four implementations that must stay in step:

1. `scene-fabric/src/background-media.ts` — `placement()`, the DOM and glass
   authority: cover fit, scale zoom, offset pan, `panFloor` inflation.
2. `host/src/panels/panel-video-composition.ts` — `panelCrop()`, re-derives a
   source window from `placement()`.
3. `host/src/panels/tur-usb-video.ts` — `panelFilter()`, a second copy written
   as inline ffmpeg expressions (`scale=w=iw*factor`, `crop=…clip(…)`),
   including its own `panFloor`.
4. `host/src/themes/video-frame.ts` — `cropPlan()`, a fourth copy for the
   pre-baked page clip.

They already disagree: the USB copy applies `panFloor` inflation, `panelCrop`
and `cropPlan` apply it too, while the TURZX plain path and the composed path
reach it through different code. A change to what scale or offset means must be
made in four places and proven four times, and a miss fails quietly — the
device shows a picture the page does not.

The authored semantics also need to change. Today scale zooms the picture inside
a fixed media area: a 16:9 video centred on a 4:1 Lian Li strip stays a 44%-wide
band, so 200% crops the picture while the fill gaps stay unchanged. The media
area must be the thing that scale and offset move.

## Decision

One pure resolver in `renderer-core` returns everything every surface needs; no
other module derives media geometry.

- `renderer-core/src/theme/background-composition.ts` owns the base area, the
  scale anchor, the offset slide, the cover rect, the visible rect and the
  source window.
- `scene-fabric`, both host panel encoders, the page-clip transcode and the
  player all consume that result.
- The USB and TURZX encoders share one `panelFilter()`; each keeps only its
  encoder flags and wire protocol.
- `placement()`, `panelCrop()`, `cropPlan()`, both inline ffmpeg copies,
  `panFloor`, `boundedScale` and `backgroundGeometryOf` are deleted, not
  deprecated.

This is a rendering mechanism change: `docs/decisions/0028-background-media-one-path.md`
records the seven-rung evidence before implementation.

## Semantics

### Base area

| Background | Base area |
|---|---|
| simple (mode `simple`) | the bounds box |
| advanced `center` | contain-fit of the source: its long edge fits the box |
| advanced edge anchor | the extent band, as today |

Source size unknown keeps the existing fallback: the box covers itself until the
bytes arrive, then the media re-places.

### Scale

`scale` (1–5) multiplies the base area about its anchor:

- simple and `center`: the box centre;
- `left` / `right` / `top` / `bottom`: the pinned edge, so the band stays flush
  and grows across the box.

The area may exceed the box. The bounds box clips; nothing shrinks it back.

### Offset

`offsetX`/`offsetY` translate the area:

```
t = clamp(offset × boxSize, ±|boxSize − areaSize| / 2)
```

`0` is centred, `±1` is flush with the opposite box edge, larger magnitudes
saturate. The old `panFloor` zoom inflation is gone: an offset moves the area
and never secretly zooms the picture.

### Media placement

The picture covers the area. From that:

- `cover` — the cover rect of the area in box pixels; may extend past the box.
  A live DOM element is placed here and clipped by the area layer.
- `dest` — `cover ∩ box`: the visible rect, in box pixels.
- `crop` — the source window that fills `dest`, integer pixels, clamped inside
  the source.

`crop → dest` is the one mapping every encoder, the page-clip transcode and the
glass sampler use. A pre-baked clip is encoded at `dest` size and placed at
`dest`, so the host never encodes more pixels than the panel can show.

For `center` the area keeps the source aspect, so `crop` is the whole frame and
only the panel edge crops. For an edge band the picture still covers the band,
as today.

### Masks

The fade geometry is unchanged in meaning: masks are still one ramp per side
that meets the fill, computed from the final area in absolute box coordinates.
Consumers that encode a ramp map it onto `dest` instead of the area, so no
negative overlay is needed.

When the source size is unknown, the resolver reports `media: undefined`;
consumers place the media at the area as they do today and re-place once the
size is known.

## API

```ts
export interface BackgroundMediaGeometry {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function backgroundGeometry(
  media: BackgroundMedia | undefined,
): BackgroundMediaGeometry;

export interface CompositionCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CompositionMedia {
  readonly cover: CompositionRect;
  readonly dest: CompositionRect;
  readonly crop: CompositionCrop;
}

export interface BackgroundComposition {
  readonly region: CompositionRect;
  readonly masks: readonly BackgroundMask[];
  readonly media?: CompositionMedia;
}

export function resolveBackgroundComposition(
  box: { readonly width: number; readonly height: number },
  composition: BackgroundMediaComposition | undefined,
  source?: { readonly width: number; readonly height: number },
  geometry?: BackgroundMediaGeometry,
): BackgroundComposition;
```

`composition === undefined` is the simple background, and `geometry` applies to
it too. `backgroundGeometry` is the single clamp for authored values, replacing
`backgroundGeometryOf` in the host and the per-call defaults in `scene-fabric`.

## Surfaces

| Surface | Reads |
|---|---|
| `scene-fabric` `place()` | `region` for the layer and masks; `media.cover` for a live element; `media.dest` for a host-baked clip |
| `scene-fabric` `backdrop().paint()` (glass) | `region`/`masks`; `crop` → `dest` via `drawImage` |
| `panel-video-composition.ts` `composeFilterGraph` (USB and TURZX) | `crop` → `scale` to `dest`; overlay at `dest`; masks mapped onto `dest`; fill across the box |
| shared `panelFilter()` (new) | composed → `composeFilterGraph`; plain → `crop` + `scale` + flip + turn as `-vf`; facts missing → the shared aspect-unknown fallback |
| `theme-media.ts` `panelVideo` + `video-frame.ts` `transcodeVideo` | `crop` → `dest`; output is `dest`-sized |
| player `framed` clip | `media.dest` |

`tur-usb-video.ts` and `turzx-video.ts` keep only their encoder invocation,
their turn/flip application and their cache behaviour; both call the shared
`panelFilter`.

## Deletions

- `scene-fabric/src/background-media.ts`: `PlacementInput`, `placement()`,
  `panFloor`, `boundedScale`, `bounded`, `geometry()`.
- `host/src/panels/panel-video-composition.ts`: `panelCrop()`.
- `host/src/panels/turzx-video.ts`: `panelFilter()`, `plainFilter()`,
  `EncodeFilter` (moves to the shared module).
- `host/src/panels/tur-usb-video.ts`: `panelFilter()`.
- `host/src/themes/video-frame.ts`: `cropPlan()` and its offset/scale fields.
- `host/src/themes/theme-media.ts`: `backgroundGeometryOf()`.

## Caches

Both panel clip names already include the authored geometry and composition.

- `theme-media.ts` `PANEL_CLIP_REVISION` 2 → 3.
- `turzx-video.ts` `TRANSCODE_VERSION` v4 → v5.

A cached clip from the old geometry must not survive the change.

## Compatibility

No schema, validator or editor control change. Existing themes with non-default
scale or offset paint differently — that is the requested behaviour change. The
offset range stays ±5; an area reaches its flush position once `|offset| × box`
meets the limit above, and a larger magnitude saturates there.

## Non-goals

- No new persisted field, no second document format, no migration.
- No per-surface crop maths: a surface that needs a crop calls the resolver.
- No change to fade/fill meaning, flips, mask shapes, turn/flip order or the
  encoder flags.
- No attempt to share the device encoders themselves; only their geometry.

## Verification

- Resolver: base areas (simple, centre, every edge anchor), scale anchor per
  area, offset clamp and saturation, `cover`/`dest`/`crop`, source unknown,
  area larger than the box, masks at an offset area.
- `scene-fabric`: live element at `cover`, framed clip at `dest`, mask CSS,
  glass `drawImage` uses `crop`/`dest`, flips still outside the rect.
- Host: shared `panelFilter` for plain and composed at scale 2 and offset;
  filter graph crops to `crop` and scales to `dest`; no negative overlay;
  tur-usb and turzx tests keep only device-specific expectations.
- `theme-media`/`video-frame`: clip is `dest`-sized and cropped by `crop`.
- `npm run gate` exits 0.
- Manual: editor preview, a USB Lian Li panel and a TURZX panel show the same
  crop for the 16:9-on-4:1 theme at 200%.

## Open risks

- A large scale can make `cover` several times the panel; only `dest` is ever
  encoded, so clip bytes stay bounded by the panel size.
- The page computes its own `dest` from the same resolver; host and page must
  resolve the same box. The host's `panelMediaBox` and the page's
  `displayScreenRect`/`artboardScreenRect` already share
  `computeArtboardTransform`, and the verification holds them together.
- Cached themes still carrying old-geometry clips are invalidated by the two
  revision bumps; a theme package exported with a clip baked elsewhere is out of
  scope, as before.
