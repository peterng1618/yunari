# 0052 — A circle theme is a persisted artboard shape

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/document.ts`,
  `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`,
  `src/web/packages/renderer-core/src/theme/envelope-keys.ts`,
  `src/web/packages/scene-fabric/src/scene.ts`,
  `src/web/packages/editor/src/editor-session.ts`

## Problem

Round panels (Kraken Z, TURZX) take a square artboard, but nothing in the
document says the theme is round. The roundness lives in two unrelated places:
the host's display record (`DisplayPresentation.shape`, passed to the scene at
mount), and the editor's browser-local preview catalogue. A square theme opened
anywhere else — a thumbnail, a rect monitor, another host — is a rectangle, and
a rectangular theme cannot be authored for the disc at all.

The two framings are inverses and must not be conflated:

| | Rect theme on a round display (today) | Circle theme (new) |
|---|---|---|
| Artboard | any ratio | square |
| Glass | display's disc; artboard **inscribed** (corners on the ring) | disc **inscribed in the artboard** (diameter = side) |
| Corners | inside the glass | outside the glass, deliberately cropped |
| Scale on 480 px | `480 / hypot(w, h)` | `480 / w` for a square |

Choosing the wrong seam fails quietly: a display-level fix renders a circle
theme correctly only on the host that set it, and a ratio-only fix cannot tell a
circle theme from a square rectangle.

## Rung 1 — internal owner

Searched: `codegraph explore "computeArtboardTransform DisplayShape Artboard
artboard"` (the worktree's `.codegraph/` holds only `.gitignore`, so the CLI
refused: no index), then grep and source reads of `artboard.ts`,
`artboard-presets.ts`, `display-lens.ts`, `scene.ts`, `document.ts`,
`envelope-semantics.ts`, `envelope-keys.ts`, `editor-session.ts` and
`host/src/settings/display-presentation.ts`.

Found: `renderer-core/src/artboard.ts` owns the geometry vocabulary.
`DisplayShape` is `"rect" | "circle"`; `computeArtboardTransform`'s circle
branch is `Math.min(viewport.width, viewport.height) /
Math.hypot(artboard.width, artboard.height)` — the artboard is inscribed in the
disc, corners on the ring, and it reports no bars or crop. `rotationAllowed` and
`snapRotation` are the one owner of the shape's angle rule.

`editor/src/artboard-presets.ts` already carries a `circle` ratio at 1:1 (added
by commit `3a0bfc9f`); `artboardSize` derives a square at each resolution and
`artboardOrientation` calls a square landscape. The ratio names a size only —
`artboardPresetFor` matches width/height, so a square circle theme and a square
rectangle theme are indistinguishable.

`editor/src/display-lens.ts` has a separate, browser-local `PreviewShape`:
`Circle` parses to 1×1 shape `circle`; `lensBox` returns a disc whose bounding
square is the artboard's diagonal, so the artboard corners lie on it. The list
lives under `yunari.editor.preview-ratios` and never enters the envelope.

`scene-fabric/src/scene.ts` owns presentation at render time: `displayBox`
returns the centred disc for `shape: "circle"`, and `applyPresentation` paints a
DOM disc and sets `element.style.clipPath = circle(<r>px at x y)`. The disc and
letterbox belong to the screen; only the composition (plate and theme-bounded
media) turns with the mount angle.

`host/src/settings/display-presentation.ts` validates the display record's
shape and angle (`normalizePresentation`), and the player passes it as
`FabricSceneOptions.presentation`.

Unsolved: no persisted field says the theme is round. The artboard section of
the envelope is `{ width, height, contentFit }` in `document.ts`,
`envelope-keys.ts` (`artboard: ["width", "height", "contentFit"]`) and
`envelope-semantics.ts` (`validateArtboard`), and the schema's artboard object
has `additionalProperties: false`. A new key must be added in all four places
together or a circle theme is refused on save/load.

## Rung 2 — installed dependencies

Searched: Fabric 7.4.0 (`node_modules/fabric/dist/index.js`,
`packages/editor/src/artboard-clip.dom.test.ts`, `thumbnail-capture.ts`) and
`scene-fabric/src/background-media.ts`.

Found: `StaticCanvas.toCanvasElement` exists (Fabric's dist, used by
`thumbnail-capture.ts:46`) and captures the canvas at a multiplier; it donates
export, not semantics. Fabric supports a **canvas-level** `clipPath` — the
editor uses that, not an object's `clipPath`, because an object clip collides
with the crop manager's authored image clip and the derived text-box clip
(`vg-046`, `artboard-clip.dom.test.ts`). It is a render-time property, not
serialised into the scene. `background-media.ts` clips a media layer to its box
with `layer.style.borderRadius = box.radius === "circle" ? "50%" : ""`.

Fabric therefore donates the two clipping routes and the export capture, and
leaves the document question unsolved: neither route persists what shape the
theme is, and a clip set by one surface is not read by another.

## Rung 3 — native platform

Searched: the Canvas 2D `clip()`/path API used by the player path, and CSS
`clip-path` / `border-radius`. `scene.ts` already uses
`clip-path: circle(<r>px at <x>px <y>px)` for the disc and `border-radius: 50%`
for the disc element; `background-media.ts` uses the same border-radius on the
media layer.

Found: the platform provides the shape primitives — a Canvas 2D arc path plus
`ctx.clip()`, CSS `clip-path: circle()`, and `border-radius: 50%` — but each is a
paint-time instruction attached to one element. None carries a document model,
serialises with the theme, or tells a renderer whether the artboard or the disc
is the authored canvas. The platform leaves the ownership question, and the
square-versus-inscribed geometry choice, entirely to the application.

## Rung 4 — public solutions

Searched (exa): "Android Wear round display design guidelines inscribed square
safe area round vs square watch UI"; "Wear OS watch face design guidelines round
display layout bounding box 320x320".

Found:

- **Wear OS, "Handle different watch shapes"** — a rectangular layout's corners
  are cropped on a round watch; `BoxInsetLayout` with `layout_boxedEdges="all"`
  boxes children in the centre **square** of the round screen after window
  insets. The safe-area model is an inscribed square, not an inscribed
  artboard-in-disc.
- **Wear OS app quality** — content must fit the physical display and be at
  least a 192 dp circle; no text or controls may be cut off by the screen edge.
- **Wear OS design guidance** — a round screen has about 22% less usable area
  than a square one and needs larger margins.
- **Watch Face Format, `WatchFace`** — `width`/`height` describe a square visual
  screen (320×320 is the documented background size); `clipShape` is
  `NONE | CIRCLE | RECTANGLE`, default `CIRCLE`, and "elements near the corners
  become partially cut off". The authored canvas is the square; the system masks
  the disc.
- **"Designing Watch Faces"** — one 320×320 background serves both square and
  round devices; "the corners of the background image are not visible on round
  devices".

The consensus matches the intended model: author one square, treat the disc as
the glass, keep essential content inside the circle, and accept that corners are
cropped. The platforms differ on where the square lives (a runtime mask versus a
document flag); a persisted flag is what lets the theme travel between surfaces.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| (a) A ratio entry, `circle`/`1:1` in `ARTBOARD_RATIOS` | Already shipped (`3a0bfc9f`); names a square size | Says size, not shape: a square circle theme equals a square rectangle theme in `artboardPresetFor`; every renderer still treats it as a rect; no conversion or disc clipping | Reject as the model; keep `1:1` as the square creation choice |
| (b) Today's display-circle geometry (`DisplayPresentation.shape`) | Already renders round panels; no document change | Inverts the framing (artboard inscribed in the disc, `scale = viewport / hypot(w, h)`); lives on the host's display record, so it is lost on a rect monitor, a thumbnail or another host; not authorable and not exportable | Reject as the theme model; keep it as the display treatment for rect themes |
| (c) Persisted `Artboard.shape` | Authored state in the envelope section that already holds the artboard; travels with the theme to player, editor, thumbnails and every host | Validator rule (circle must be square), key added in document/keys/semantics/schema, scene disc mask, editor Shape control and one conversion operation | **Implement** |

The unsolved work in (c) is the four-file vocabulary sync the envelope already
requires, not a new mechanism. Display presentation stays a separate record
because mounting angle and glass are properties of the hardware, not the artwork.

## Rung 6 — smallest probe

Ran from outside the repo (a scratch `.mjs` in the OS temp directory) against
the real source:

- `computeArtboardTransform({ artboard: 1080×1080, viewport: 480×480,
  shape: "circle" })` → `scale = 480 / hypot(1080, 1080) =
  0.31426968052735443`.
- `480 / 1080` (the proposed square rule) → `0.4444444444444444`.
- `shape: "rect"` on the same inputs → `0.4444444444444444`.

This measures the inversion: today a square theme under a round display shrinks
to 31% and shows its corners on the ring. The intended circle theme fills the
same viewport (44%) and its disc — radius `min(w, h) / 2`, diameter = side — is
the mask, so the corners fall outside the glass. `artboard.test.ts` already
pins the current circle branch (inscribed artboard, no bars, no crop), which the
change must not disturb for rect themes.

## Decision

Add `shape?: ArtboardShape` to `Artboard` (`theme/document.ts`), where
`ArtboardShape = "rect" | "circle"` is exported from `artboard.ts` beside
`DisplayShape` so the vocabulary has one owner (the editor's ratio+orientation
type is renamed `ArtboardPresetShape`). Absent means `"rect"`. The field is
additive, so schema version stays `2.0.0` and an older document reads as a
rectangle.

`validateArtboard` (`theme/envelope-semantics.ts`) accepts only `rect`/`circle`
and refuses `shape: "circle"` with `width !== height`; the schema records the
enum and a description, because JSON Schema cannot compare two properties.
`theme/envelope-keys.ts` adds `shape` to the `artboard` key set, with the
published schema and the drift test in the same change.

`scene.ts` receives the theme's shape and, for a circle theme, fits with the
**rect contain rule** (`viewport / w` for a square) and clips the composition
(plate, theme-bounded media, scene objects) to the inscribed disc. Display
presentation remains the owner of the hardware's shape and mount angle; a rect
theme on a round display keeps today's inscribed-artboard geometry unchanged.
`editor-session.ts` is the editor's write point: it passes the artboard shape to
the scene and offers the Shape control, with `editor-document.setArtboard` as
the single document write and history entry for rect → circle conversion.

Rejected: a ratio entry cannot express the shape; today's display-circle
geometry inverts the framing and belongs to the host; a theme-level
`presentation { shape, rotation }` would model the display's mount angle as
authored content; a guide-only disc would ship content the panel cannot show.
