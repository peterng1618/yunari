# Circle theme shape

- **Date:** 2026-11-01
- **Status:** accepted
- **Decision note:** `docs/decisions/0052-circle-theme-shape.md` (written before implementation)

## Problem

Round panels (Kraken Z, TURZX) are served by a square artboard today. The
artboard is **inscribed in the display's disc**: `computeArtboardTransform`
scales the artboard so its diagonal equals the disc diameter
(`renderer-core/src/artboard.ts`), so every artboard corner lands on the ring and
a 1080² theme renders at ~226 px on a 320 px panel. That treatment is correct for
a theme authored as a rectangle — its content is never cropped — but it cannot
express a theme authored **for** the disc: one that fills the panel and treats
the four corners as outside the glass.

`Circle` currently exists only as an entry in `ARTBOARD_RATIOS` (commit
`3a0bfc9f`), i.e. a 1:1 canvas. A square theme is still a rectangle to the
renderer; nothing in the document says the theme is round, so no surface other
than a round panel can show it as a disc, and an existing rectangular theme
cannot be turned into one.

## The mechanic

There are two distinct modes, and they must not be conflated:

| | Rect theme (today) | Circle theme (new) |
|---|---|---|
| Artboard | any ratio | square, required |
| Glass | the display's disc; artboard **inscribed** (corners on the ring) | disc **inscribed in the artboard** (diameter = side) |
| Corners | inside the glass | outside the glass, deliberately cropped |
| On a round panel | artboard shrinks to fit | artboard fills the panel |

A circle theme says: the artboard is the full square I design on; the visible
glass is the circle inside it. The square's four corners are outside the theme.
The author is expected to keep content inside the circle; content outside it is
clipped on output.

## Data model

- `Artboard` (`renderer-core/src/theme/document.ts`) gains
  `shape?: ArtboardShape`, where `ArtboardShape = "rect" | "circle"`. Absent
  means `"rect"`.
- The vocabulary has one owner: `renderer-core/src/artboard.ts` exports
  `ArtboardShape` beside `DisplayShape` (`DisplayShape = ArtboardShape`). The
  editor's existing local `ArtboardShape` type (ratio + orientation,
  `artboard-presets.ts`) is renamed `ArtboardPresetShape`; it is internal.
- A persisted circle artboard must be square. The validator refuses
  `shape: "circle"` with `width !== height`; JSON Schema cannot compare two
  properties, so the schema records the enum and a description, and the
  validator owns the equality rule.
- Schema version stays `2.0.0`. The field is additive and optional; an older
  document reads as `rect`. `schema/theme-document.schema.json`,
  `validateArtboard` (`envelope-semantics.ts`), `envelope-keys.ts` and their
  sync tests change together.
- Artboard rotation is not added. Rotation remains a display mounting property.

## Creation

- `ARTBOARD_RATIOS` drops `circle` and gains `1:1` so a square rectangular
  canvas is still offerable. Type `ArtboardRatioId` becomes
  `"16:9" | "19.5:9" | "4:3" | "1:1"`.
- The new-theme chooser and the Artboard panel gain a **Shape** select above
  Ratio: `Rectangle` / `Circle` (`ControlSelect`, same component as the other
  preset controls).
- Circle fixes the canvas to a square at the chosen resolution: ratio and
  orientation are not rendered as choices while the shape is Circle; the
  resolution still names the square's edge (`1080p` → 1080 × 1080).
- The chooser's answer carries the shape as well as the size, so
  `NewDocumentAnswer` and `createBlankFabricTheme` take a whole `Artboard`.
- For a circle answer, the opening preview lens is the catalogue's circle lens
  when one exists (see `lensMatching`); otherwise Fit.

## Conversion: rect → circle

Selecting Circle on an existing theme is one document operation and one history
entry:

1. Let `side` = the current artboard's shorter edge (the resolution rule).
2. Let `s = side / hypot(width, height)`.
3. For every top-level object on the canvas: scale its origin point about the
   artboard centre and multiply `scaleX` and `scaleY` by `s`
   (`left' = side/2 + (left − width/2) · s`, the same for `top`). Uniform scale,
   so angles and shapes are preserved.
4. Set `width = height = side` and `shape = "circle"`.

The old composition's bounding box then lands exactly inside the new disc: its
corners touch the ring, nothing is lost, and the disc margins are the surround.
An already-square theme converts by the same rule and its content shrinks to fit
the disc.

Circle → rect clears the flag and keeps the square canvas. It is not an inverse
resize: the previous size is not stored.

**Undo.** Today the history entry carries the scene and globals; the artboard is
not undoable. The conversion therefore extends the history manager's envelope
port from `globals` to `{ globals, artboard }` so the restored entry carries
both, and records the conversion with `suspend()` → mutate → `save()` as one
entry.

## Editor preview

The preview lens remains the author's choice; a circle theme does not force it.

- Circle lens active: the canvas clip becomes a `Circle` inscribed in the
  artboard (centre the artboard centre, radius `min(width, height) / 2`) and
  corner content is cropped in preview.
- Rect lens active, or Fit: the clip stays the artboard `Rect`; a **disc guide**
  outlines the actual theme — a `Circle` in artboard coordinates transformed by
  the camera, the same geometry family as the existing rect
  `data-yunari-theme-guide` element. Corner content stays visible for
  authoring.
- The camera uses the rect contain rule for a circle theme, so a square
  artboard fills a square lens box and the disc fills the glass. The existing
  diagonal rule stays for a **rect** theme under a circle lens.
- With a circle lens, the screen element is the disc inscribed in the artboard
  (its bounding box is the artboard's screen rect), so it coincides with the
  disc guide; the guide is hidden when coincident, like the rect guide.
- Media placement follows the actual picture: theme-bounded media is clipped to
  the disc (`radius: "circle"` on the artboard box); display-bounded media
  keeps the display window (rect) or the disc (round display) as today.
- Rect themes are unchanged in every respect.

## Output rendering

Applies to the player, hardware panels (which render the player), and previews.

- The scene receives the theme's shape (`FabricSceneOptions.themeShape`).
- For a circle theme the transform uses the rect contain rule; the composition
  (scene objects, theme-bounded media, and the artboard plate) is clipped to the
  inscribed disc.
- Outside the disc: display-bounded background media fills the display window
  when the background's bounds are `display`; otherwise the background colour
  paints the surround. The background colour is always the letterbox.
- On a round display the display box is already the disc's square, so the theme
  disc coincides with the panel glass and nothing extra is painted.
- On a rectangular display the disc is drawn inside the window; the corners of
  the disc are the background.
- `updatePresentation` continues to change the display shape/angle only; the
  theme mask is a property of the loaded document and survives presentation
  changes.
- The host gains no new concept: panel rendering is the player page.

## Thumbnails

A circle theme's stored thumbnail is the disc, whatever lens the author was
using. The capture forces the disc clip for a circle artboard and composites the
background (colour and media) beneath the cropped scene, then restores the live
clip. Library and store cards therefore match what a panel shows.

## Owners and touchpoints

- Vocabulary and geometry: `renderer-core/src/artboard.ts` (shape type), plus a
  single helper for the effective display shape of a theme.
- Persistence: `renderer-core/src/theme/document.ts`,
  `fabric-envelope-validate.ts`, `envelope-keys.ts`,
  `schema/theme-document.schema.json`.
- Presets and copy: `editor/src/artboard-presets.ts`, `ui-copy.ts`.
- Creation: `editor/src/new-document-chooser.tsx`, `new-fabric-theme.ts`,
  `editor-main.ts`.
- Conversion: `editor/src/editor-document.ts` (`setArtboard` /
  shape-change entry point), `history-manager/index.ts`.
- Editor preview: `editor/src/viewport-manager/index.ts`,
  `editor/src/editor-shell.ts`, `editor/src/display-lens.ts`.
- Scene rendering: `scene-fabric/src/scene.ts`,
  `scene-fabric/src/background-media.ts`.
- Player: `player/src/main.ts`, `player/src/hosted-plan.ts` if the plan needs
  the shape.
- Thumbnails: `editor/src/thumbnail-capture.ts`.

## Rejected alternatives

- **Keep `Circle` in the ratio list.** A ratio control would choose a display
  shape; conversion would stay a manual canvas edit; no surface outside a round
  panel could show the theme as a disc.
- **Reuse today's circle-display geometry.** That is the inscribed-artboard
  treatment the round panels already apply to square themes; a circle theme
  built on it would be indistinguishable from a square theme.
- **Theme-level `presentation { shape, rotation }`.** Rotation is a mounting
  property of the display, not authored content; modelling it in the document
  is speculative.
- **Draw the disc only as a guide, never clip.** Content outside the disc would
  ship where the panel cannot show it.

## Testing

- Validator: accepts `rect`/`circle`, absent = rect, refuses a non-square circle,
  refuses an unknown shape; published schema stays in sync.
- Presets: `1:1` exists, `circle` does not; `nearestArtboardPreset` maps a
  square size to `1:1`; a circle answer is square at each resolution.
- Conversion: 1920 × 1080 → 1080 × 1080, scale `1080 / hypot(1920, 1080)`,
  every object's origin and scale transformed about the centre, one history
  entry that restores both scene and artboard on undo.
- Editor: circle lens crops to the disc; rect lens keeps the rect clip and
  shows the disc guide; the guide hides when coincident.
- Scene: a circle theme on a rect window clips to the disc and paints the
  display-bounded media or background colour outside it; a circle theme on a
  round display fills the panel; a rect theme on a round display keeps the
  inscribed behaviour.
- Thumbnail: a circle theme captures a disc regardless of the active lens.

## Out of scope

- Non-square circle artboards.
- Automatic migration of existing rectangular themes.
- Artboard rotation.
- Any change to how a rect theme is rendered on a round display.
