# 0094 — The background translates and mirrors; it never shrinks, stretches or fills

- **Date:** 2026-10-23
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/`, `src/web/packages/scene-fabric/src/background-media.ts`

## The problem

[0093](0093-the-background-is-a-virtual-layer.md) made the background a virtual
layer with a media bag of `assetId, bounds, fit, scale, offsetX, offsetY`. Its
`fit` could be `contain` or `fill` and its `scale` could shrink below 1, so the
placed media could be smaller than its box on both axes and the colour showed
through inside the box. That gap was reachable by authoring, not by mistake: the
inspector offered the controls that produced it.

The owner's ruling after the final review is that the media is **always
`cover`** and the author's geometry is **translation only**, plus two paint-time
mirrors. Removing the shrink and stretch controls makes the gap unreachable
rather than discouraged. Cover is not by itself enough: a covering rect slides
off its box under a large enough translation exactly like any other. What makes
the edge unreachable is the **bounded pan** — `placement()` stops the media's
edge on the box's edge, so an offset at ±100% can never expose the colour
inside the box.

This note supersedes 0093's media fields. It does **not** supersede 0093's
decision — the envelope section, the virtual row, the one placement owner and
`object-fit`-free rendering all stand. 0093's own status line is left `accepted`
because the repo's `Status:` vocabulary has no partial form and marking the
whole note superseded would be false.

## Rung 1 — Yunari

Searched: `theme/document.ts`, `envelope-keys.ts`, `envelope-semantics.ts`,
`schema/theme-document.schema.json`, `scene-fabric/background-media.ts` and its
placement/DOM tests, `scene.ts`, `glass.ts`, `selection-inspector/background-column.ts`
and its tests, `ui-copy.ts`, the browser fixtures `tests/e2e/host-theme.ts`,
`background-layer.spec.ts`, `editor.spec.ts`, `panel-labels.spec.ts`.

Found: the whole rendering and inspector path from 0093 exists and is one owner
(`placement()`); nothing needs building. What exists to remove is spread across
five owners — the type, the key bag, the validator, the published schema and the
inspector — and each has its own test. Flip exists nowhere: no `flipX`/`flipY`
in the format, the renderer, the inspector or the sampler.

## Rung 2 — dependencies

Searched: every `src/web/packages/*/package.json` loaded by `background-media.ts`.

Found: the file imports nothing but `@yunari/renderer-core` and its own
`glass.ts`. No image-transform, matrix or object-fit package is installed, and
the two operations wanted here — `Math.max` for cover and a CSS/canvas mirror —
are platform primitives.

## Rung 3 — platform

Searched: CSS `object-fit` (`cover` only) and CSS `transform`; canvas
`drawImage`, `ctx.translate`/`ctx.scale`/`ctx.save`/`ctx.restore`.

Found: the cover formula is `s = max(box.width / source.width, box.height /
source.height)` — one `Math.max` on values the placement already computes.
CSS `transform: scaleX(-1)` / `scaleY(-1)` mirrors an element about its own
centre, which is the placed rect's centre because the child *is* positioned as
that rect with left/top/width/height and carries no other transform. On the
canvas side `drawImage` does **not** flip a negative destination width (MDN is
explicit: "pixels are always processed in the original direction and the image
is not flipped"), so the mirror has to be a context transform. `ctx.save()` →
`translate(centre)` → `scale(±1, ±1)` → `drawImage` at the rect's half-size →
`ctx.restore()` is the platform-idiomatic form and leaves no state behind.

## Rung 4 — ecosystem

Searched (Exa, live):

- `canvas drawImage mirror flip image scaleX(-1) same as CSS transform background image`
- `background image cover with pan offset only, no zoom scale control design editor background reposition`
  — **refused by the Exa free-tier rate limit**; no results returned, so nothing
  from this query is claimed below. The design-editor comparison rests on 0093's
  rung 4 (Canva repositions/resizes a background and pins the row; Figma treats
  it as a frame fill), which is unchanged by this ruling.

Found: mirroring is consistently solved as *two* renderings of one operation —
DOM `scaleX(-1)` and a canvas translate+scale — never as one shared object; the
recurring StackOverflow answers differ from ours only in that they flip a
*whole* canvas rather than a placed rect, and the one that flips about the
image's centre (`drawImage(..., -w/2, -h/2, w, h)` after
`translate(x+w/2, y+h/2)`) is exactly the arithmetic this note adopts. No library
was found that shares a placement rect *and* its mirror between a DOM layer and a
canvas sampler, so ours stays hand-derived from one owner. The "cover plus pan,
no zoom" control set is what 0093 found in Canva's background reposition; no
source found in this pass contradicts it.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep `fit`/`scale`, merely default to `cover` | Authors keep zoom | No code removed | The gap stays reachable: `contain` and `scale < 1` both expose colour inside the box, and the inspector invites it | Rejected — the ruling is to make the gap unreachable |
| Keep `fill` only (stretch, no shrink) | Stretches to fill | One formula branch survives | Distorts the source for no authoring benefit the offsets do not give | Rejected |
| **`cover` always; `offsetX`/`offsetY`; flip as a paint-time transform** | Exact: the media always covers, so only its crop is authored | Removes five owners' worth of `fit`/`scale` and adds two booleans | DOM/glass flip parity (one expression, two consumers); flip must not enter `placement()` or it would move the rect and the gap proof | **Chosen** |
| Flip by rewriting the destination rect (negative width, mirrored left) | Renderer only | No canvas transform | `drawImage` does not flip a negative destination width (rung 3), so the sampler and the DOM would disagree | Rejected |

## Rung 6 — probe

No new probe is needed, and the reason is specific: 0093's rung 6 already
measured the cover placement formula against the browser's own DOM painting and
against `drawImage`, exactly on both axes and within one device pixel on the
scaled one. The change here keeps the same formula and drops the two branches
that were measured beside it. The new operation — a mirror — derives no geometry:
it is the same rect with one axis negated about that rect's centre, and both
consumers use the platform's own transform. Its proof is therefore a rendered one
rather than a formula one, and it is in the browser spec: the background layer's
fixture is flipped and the pixel read inside the placed rect must show the
source's mirrored side.

## Rung 7 — build

- **Format.** `background.media` becomes `{ assetId, bounds, offsetX?, offsetY?,
  flipX?, flipY? }`. `BACKGROUND_MEDIA_FITS`, `BackgroundMediaFit`,
  `MIN/MAX_BACKGROUND_SCALE` and the `fit`/`scale` keys are deleted from the type,
  the key bag, the validator and the published schema. `BACKGROUND_MEDIA_DEFAULTS`
  keeps only the offset defaults; flip defaults to `false`, i.e. the key is
  omitted. `schemaVersion` stays 2: a stored `fit` or `scale` is refused by the
  unknown-key check (`unknown-field`), with no converter and no fallback, exactly
  as 0093 refused the artboard keys.
- **Placement.** `placement({ box, source, offsetX, offsetY })` takes the `cover`
  factor always. Before the source has an intrinsic size it returns the box and
  **ignores the offsets**, so the load window has no strip either; the first
  `load`/`loadedmetadata` re-places with them.
- **The pan is bounded by the placed rect's overhang.** Cover alone does not
  make a translation safe — a rect that merely covers slides off its box exactly
  like any other — so the pan is clamped to the rect's own overhang on each
  axis: the media's edge stops on the box's edge. The authored value is still
  validated as `-1..1` and stored unchanged; the bound is rendering, not
  validation. **0095 supersedes the rest of this paragraph**: a source whose
  cover rect is exactly the box used to have no overhang and an inert offset, so
  an offset now zooms the picture until the pan it asks for fits. The clamp
  itself is unchanged.
- **Flip.** `flipX`/`flipY` are a paint-time mirror about the placed rect's
  centre: the DOM child composes `scaleX(-1)`/`scaleY(-1)` into its `transform`
  (it carries none today, so nothing is overwritten), and the glass sampler
  applies the same transform around its `drawImage`. **Flip never enters
  `placement()`** — the rect, and therefore the no-gap proof, is unchanged by it.
- **Inspector.** Position is bounds, the offset pair, and two flip toggles
  (`background.flipX`, `background.flipY`). The fit select, the scale field and
  their field ids leave the dispatcher. Fractions stay stored and offsets stay
  displayed as percentages.
- **Colour.** Unchanged: the letterbox fill under `bounds: "theme"` and the
  no-media fill otherwise. With `cover` it can no longer show inside the box.

The reason is the ruling's own: an authored control whose only purpose is to
produce a defect is a defect. Translation keeps the one authoring case 0093
named — a subject moved to one side — and `cover` plus the bounded pan
guarantees the case can never undercut its own box.
