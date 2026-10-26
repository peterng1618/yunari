# The preview lens and the stage — design

- **Date:** 2026-10-26
- **Status:** draft
- **Related:** [`2026-10-23-background-layer-design.md`](2026-10-23-background-layer-design.md),
  [`docs/architecture/ownership.md`](../../architecture/ownership.md),
  [`docs/decisions/0075-a-background-fills-one-of-two-boxes.md`](../../decisions/0075-a-background-fills-one-of-two-boxes.md),
  [`docs/decisions/0093-the-background-is-a-virtual-layer.md`](../../decisions/0093-the-background-is-a-virtual-layer.md),
  [`docs/decisions/0095-the-pan-implies-its-zoom.md`](../../decisions/0095-the-pan-implies-its-zoom.md),
  `docs/design/mockups/current/shell.html`.

## Purpose

Four defects and one missing capability, all in how the editor shows a theme
inside a preview ratio:

1. **Out-of-canvas is the theme's colour.** `applyArtboardPaint` writes the
   artboard paint onto the canvas host element, so the whole stage wears the
   theme's background colour. The stage belongs to the shell.
2. **A display-bounded background does not move with the canvas.** The lens
   frame, the theme-coloured letterbox and a `bounds: "display"` media layer are
   computed in host pixels, so they stay pinned to the window while the artwork
   zooms and pans beneath them.
3. **A mismatched lens shows no guide.** When the lens aspect differs from the
   artboard's, nothing marks the theme's real extent, and with a theme-coloured
   letterbox the artboard's edge can share the letterbox's colour.
4. **No 1:1 or circular preview.** The list has no square and no round display,
   so a theme for a square panel or a round one is only ever previewed in a
   rectangular lens.
5. **Preview ratios are fixed.** The six previews are derived from the artboard
   presets, so an author cannot add, remove or reset them.

The outcome: a preview ratio sets a **virtual display** in scene space, the
camera fits it once, and any later zoom or pan moves the lens, its letterbox and
its display-bounded media with the artwork — while everything outside the lens
stays the shell's stage.

## Terms

- **Stage** — the editor's canvas ground: every pixel of the canvas region not
  covered by the virtual display.
- **Virtual display** — the box a chosen preview ratio stands for: a rect in
  **artboard units**, contained on one axis and centred, whose aspect is the
  ratio. The camera transforms it like any scene geometry. A **circle** lens is
  a disc whose bounding square is the artboard's diagonal, so the artboard's
  four corners lie on the circle.
- **Letterbox** — the part of the virtual display outside the artboard. Painted
  with the theme's background colour, as the player's letterbox is.
- **Guide frame** — an outline at the artboard's real bounds, shown under a lens
  whose aspect differs from the artboard's.
- **Preview ratio catalogue** — the author-managed list of aspects the display
  menu and the new-document chooser offer, stored browser-locally.

## Current state

- `viewport-manager/index.ts`: `displayScreenRect()` returns
  `screenRect(viewportSize(), displayLens(lens).aspect)` — a host-pixel box
  centred in the window and independent of the camera transform. `framingBox`
  uses the same function for `zoomToFit`, which is correct at fit but is also
  the source of the pinned frame once the camera moves.
- `editor-shell.ts`: `placeMedia` and `placeScreen` already subscribe to
  `viewport.onChange`; they re-place from `displayScreenRect()` and
  `artboardScreenRect()`. `applyArtboardPaint` sets
  `host.style.background = cssArtboardPaint(paint) ?? "#000"`, and the media
  layer is a DOM sibling below the canvas (`mountBackgroundMedia`).
- `scene-fabric/src/background-media.ts`: the layer is sized to
  `bounds.display` or `bounds.artboard`; `placement()` covers the box.
- `.editor-shell-stage` paints `--yunari-canvas-bg` (`#26241f`, a literal, not a
  palette role). `--stage` ("the area around the artboard", DESIGN.md §4)
  exists and is unused by the stage element. DESIGN.md §7.5 permits a subtle
  palette-derived stage texture.
- `display-lens.ts` derives `DISPLAY_LENSES` from `ARTBOARD_RATIOS` ×
  `ARTBOARD_ORIENTATIONS`. `DisplayLensId` is a derived string union,
  `uiCopy.display.displays` is a `Record` keyed by it, and
  `displayLensIdForShape` throws for a shape the table cannot frame.
- `new-document-chooser.tsx` ties the display choice to the size: picking a lens
  rewrites the artboard ratio and orientation through `displayLens(id).shape`.
- `editor-shell/settings.tsx` owns four tabs (`appearance`, `keyboard`,
  `connections`, `about`); browser-local preferences are stored by
  `editor-shell/palette.ts` and `shortcut-manager/bindings.ts` with a
  `yunari.editor.*` key.

## The virtual display

### Geometry

Given an artboard `w × h` and a lens aspect `a`, the display box in artboard
units is the smallest rect of aspect `a` that contains the artboard, centred:

```
if a >= w/h:  box = { width: h*a, height: h, left: (w - h*a)/2, top: 0 }
else:         box = { width: w, height: w/a, left: 0, top: (h - w/a)/2 }
```

A **circle** lens takes the same square box a `1:1` lens would, then sizes the
disc to the artboard's diagonal instead of to the square's edge: in artboard
units the disc's bounding square is `hypot(w, h) × hypot(w, h)` centred on the
artboard. Its fit scale is therefore `diameter / hypot(w, h)`, not
`min(box.w / w, box.h / h)`; the difference is exactly what puts the four
corners on the circle rather than leaving them outside a contain-fit square.
`fitScaleFor` and `zoomToFit` branch on the lens's shape: a rect lens contains,
a circle lens inscribes.

`displayScreenRect()` becomes the camera transform of that box:

```
left   = vpt[4] + box.left   * scale
top    = vpt[5] + box.top    * scale
width  = box.width           * scale
height = box.height          * scale
```

At `zoomToFit` this equals today's `screenRect(viewport, aspect)` for the same
lens, so selecting a ratio looks unchanged. After a wheel zoom or a pan it
moves and scales with the artwork.

- `framingBox(viewport)` keeps its host-space definition — a fit has to start
  from a box in the window. It is the *only* place a lens is still measured in
  host pixels.
- `zoomBy` centres on the current `displayScreenRect()` centre when a lens is
  active and on the host centre otherwise, so stepping after a pan does not
  walk off the virtual display.
- `isFitted()` keeps comparing the camera against `fitTransformIn`, which uses
  the host-space framing box; a fitted camera is still one where the transformed
  display box and the host framing box coincide.

### Fit and 100 %

`reset()` (100 %) and the menu's **Fit** both clear the lens. With no lens there
is no virtual display, so `displayScreenRect()` stays `undefined`, the display
screen element is hidden, and a `bounds: "display"` background collapses to the
artboard box (there is no display to fill). This is deliberate: a host-pixel
fallback would resurrect exactly the pinned layer this design removes.

### Background media

`bounds: "display"` media is placed by the layer's existing path —
`media.setBounds({ artboard, display, shape })` from `placeMedia` — with the
transformed display rect and the lens's shape. No other change to
`mountBackgroundMedia` is required; the box it receives is the scene-anchored
one. `bounds: "theme"` is unchanged, and is never circular: the artboard is the
theme, not the display.

The glass sampler's `backdrop()` already maps the rect it actually painted from
`bounds` and keeps working; when `display` is undefined under Fit, the
display-bounded case falls back to the artboard rect, matching the layer.

### A circle lens

A circle lens is the same scene-anchored box with a circular display:

- the display-screen element takes `border-radius: 50%`, so the letterbox fill
  is a disc;
- a display-bounded media layer takes the same radius and clips its media to the
  disc (`setBounds`'s `shape`);
- the artboard and the guide frame stay rectangular, and the artboard is scaled
  so its four corners lie on the disc — a 16:9 theme in a circle lens is a
  landscape card whose corners touch the circle, with the theme's colour
  between the card's edges and the disc;
- everything outside the disc is the shell stage, as for a rectangular lens.

## The stage and the letterbox

**Stage.** `applyArtboardPaint` no longer writes the theme paint to the host
element. `.editor-shell-stage` paints `--stage` plus the mockup's texture
(`docs/design/mockups/current/shell.html`):

```css
background:
  repeating-linear-gradient(45deg,
    var(--panel) 0 6px,
    color-mix(in srgb, var(--panel) 78%, var(--bg)) 6px 12px),
  var(--stage);
```

`--stage` stays the final layer, so every palette keeps its own ground (a
colour for the dark and tinted palettes, a gradient under `light`) and the
texture sits on top. `--yunari-canvas-bg` loses its last reader and is deleted.

**Letterbox.** The display-screen element (`[data-yunari-display-screen]`)
carries the theme's paint as its CSS background — set by the same paint pass that
builds the artboard plate, from the same resolved value, so it cannot drift from
the plate. It sits beneath the media layer and the canvas, so it shows exactly
where neither the artboard nor display-bounded media covers it.

The theme colour therefore appears in two places and nowhere else: the artboard
plate and the letterbox inside the lens. A theme with no colour keeps today's
black plate and letterbox.

### Guide frame

A second DOM sibling, `[data-yunari-theme-guide]`, positioned at
`artboardScreenRect()` and restyled on every camera change. Shown only when a
lens is active **and** its lens box differs from the artboard by more than one
artboard unit on either edge. The tolerance is on the box rather than on
`|lens.aspect − artboardAspect|`, because an authored board is a rounded pixel
size: `1672×941` is the same shape as `16:9` to the eye but not to a `1e-6`
aspect epsilon, which would draw a guide over a board the lens already frames.

- The lens frame stays a solid 1px `--yunari-subdued` outline.
- The guide frame is a dashed 1px outline at reduced opacity; it never fills,
  dims or takes pointer events.
- It is hidden under Fit (no lens) and when the aspects match (the two frames
  would coincide).

## The preview ratio catalogue

### Data

`display-lens.ts` becomes the owner. A ratio is
`{ width, height, shape: "rect" | "circle" }` of positive finite numbers,
identified by its normalised `"W:H"` text. Two integer edges are divided by
their greatest common divisor (`32:18` is `16:9`); an edge with a decimal
(`19.5:9`) is kept as typed after trimming. `shape` is `"rect"` everywhere
except a circle, which is only legal when `width === height`; a circle's id is
`"Circle"`, not an aspect name.

Defaults: `16:9`, `19.5:9`, `4:3`, `1:1`, and `Circle`.

A ratio derives:

- a **landscape** lens `{ id: <gcd-normalised id>, aspect: W/H, orientation:
  "landscape", shape }` when `W ≥ H` (a square or circle files here, per
  `artboardOrientation`'s "a square is not taller, so it reads landscape"),
  plus the portrait twin below when `W > H`;
- a **portrait twin** `{ id: "H:W", aspect: H/W, orientation: "portrait",
  shape }` when `W > H` (a square or circle does not duplicate);
- a **portrait** lens `{ id: <gcd-normalised id as typed>, aspect: W/H,
  orientation: "portrait", shape }` when `W < H` — the tall spelling is not
  swapped into a landscape id.

`DisplayLensId` becomes `string`. `uiCopy.display.displays` is deleted; a lens's
label is its id, which is the same rule the current table states ("each name is
the aspect it frames"), and `"Circle"` is already the name of what it frames.

### Storage

- Key `yunari.editor.preview-ratios`, a JSON array of strings: `"W:H"` for a
  rectangular ratio and `"Circle"` for the round 1:1 preview.
- Written by the settings tab; read once by the shell before the editor mounts.
- Absent key means "defaults". An unreadable, unparsable or invalid array falls
  back to defaults; individual invalid entries are dropped, duplicates are
  dropped at the position of their first occurrence.
- Reset removes the key, which is what returns the list to the defaults —
  the same absence-means-default rule `palette.ts` uses.
- An empty array is a legal author choice: the display menu offers Fit only and
  the camera opens on Fit.

Nothing here ever enters the theme envelope: a preview ratio is camera state
(DESIGN.md §67), not document content.

### Active catalogue

The live list is module-level state with a subscribe function, the shape
`shortcut-manager/bindings.ts` already uses: the viewport manager (imperative),
the display menu and the settings tab all read one catalogue through
`lenses()`, `resolveLens(id)` and `subscribeLenses(listener)`.

- The shell loads storage, sets the active catalogue and subscribes; a change
  re-renders the menu and the settings tab.
- The viewport's default lens is the catalogue's first landscape lens, or Fit
  when the catalogue is empty. It is resolved at mount from the active
  catalogue, not from a module constant.
- If the current lens disappears from the catalogue, the viewport clears the
  lens and re-fits (Fit), rather than resolving a missing id.

### Settings tab

A fifth tab, `previews`, between `appearance` and `keyboard`:

- A list of the current ratios, one row per ratio, each with a Remove control
  and its derived preview labels (e.g. `16:9` and `9:16`; a square or circle
  shows one).
- An Add row: a shape choice (**Rect** / **Circle**), a text field accepting
  `W:H` (decimals allowed) and an Add action. The field is hidden for Circle,
  which is always 1:1. Input that is not `positive:positive`, or that duplicates
  an existing ratio, is refused with a worded reason from `uiCopy`; nothing is
  guessed.
- A Reset action, disabled while the list already equals the defaults, removing
  the stored key.
- Removing the last ratio is allowed; the tab says the display menu will offer
  Fit only.

### Display menu and new-document chooser

- The display menu reads the active catalogue for both orientation groups, plus
  Fit. A group with no lens is omitted rather than headed and empty.
- The new-document chooser's preview dropdown lists the same catalogue plus Fit
  and **Custom size**. It no longer rewrites the artboard size: picking a lens
  changes the preview only. The size stays the technical controls' answer.
- The chooser opens on a lens whose aspect matches the opening shape's aspect
  and whose orientation matches the shape's orientation, if the catalogue has
  one; otherwise Fit.
- `displayLensIdForShape` and `DEFAULT_DISPLAY_LENS` are removed with their
  throw-on-missing behaviour: a user-managed list cannot guarantee the shape.

## Refusals and edge cases

- A ratio of zero, a negative edge, a non-finite number, a missing colon or a
  third part is refused by the parser; the settings field reports why.
- A ratio whose two edges are equal is square: one lens, no portrait twin.
- A circle is 1:1 by construction: it is stored as the `Circle` token, never as
  an aspect, so it cannot be authored non-square. The stored list is a closed
  vocabulary of `W:H` tokens plus `Circle`; anything else is dropped on read.
- A lens id not in the catalogue never reaches the viewport: the menu can only
  offer catalogue ids, and storage-driven changes clear a vanished lens.
- A theme-coloured letterbox and a theme-coloured artboard are distinguished by
  the guide frame, not by a second fill.
- The stage texture is a background-image on the stage element; it never
  receives pointer events and never paints inside the lens.

## Out of scope

- The artboard presets (`ARTBOARD_RATIOS`) do not gain `1:1`; a square artboard
  remains reachable through the size fields and Custom size.
- The player is unchanged: its letterbox is still the theme's colour and its
  display is the host's rect.
- **No rotation of the virtual display.** The author's screen is always upright;
  a per-display rotation is a playback setting owned by the host and the player,
  not a property of the editor's lens.
- No new persisted theme field, no schema change, no migration.

## Acceptance

1. With a theme background colour set, the stage's computed background is the
   shell palette's stage texture and not the theme colour; the artboard plate
   and the letterbox inside the lens still carry the theme colour.
2. A display-bounded background image's screen rect moves by the same delta and
   scales by the same factor as `artboardScreenRect()` after a wheel zoom and
   after a pan — proven in the browser, not only by unit geometry.
3. The lens frame follows the same transform; the display screen element's
   position after a zoom equals the transformed scene box.
4. Under a lens whose aspect differs from the artboard's, the guide frame is
   visible at the artboard's bounds and moves with it; it is absent under Fit
   and when the lens already frames the board within one artboard unit.
5. `1:1` and `Circle` both appear in the display menu by default; `1:1` frames
   the artboard in a square virtual display, and `Circle` frames it in a disc
   whose four artboard corners lie on the circle (measured from the rendered
   rects) — a display-bounded background is clipped to the disc, and the stage
   outside the disc is still the shell's.
6. Settings → Previews adds `21:9`, which enters the list reduced to `7:3`
   (the integer-pair rule above), offers `7:3` and `3:7` in the display menu,
   removes them again and resets to `16:9`, `19.5:9`, `4:3`, `1:1`,
   `Circle`.
7. Reloading keeps an authored list; reset after reload restores defaults.
8. An invalid entry is refused with a visible reason and does not enter the
   list; removing every ratio leaves Fit as the only menu entry, and the editor
   opens fitted with no crash.
9. Picking a lens in the new-document chooser leaves the artboard size
   untouched.

## Risks

- **The lens frame now leaves the viewport when the author zooms in.** That is
  the point — the display is scene geometry — but it looks different from the
  fixed window authors have seen. The guide frame and the display menu's tick
  are the only readings of the virtual display's extent.
- **`--stage` is a gradient under `light`.** A repeating gradient over a
  gradient can band; the palette's own values are used and the browser test
  reads computed colours rather than a golden image.
- **Removing derived lens ids touches the new-document chooser's coupling.**
  The chooser's size and preview become independent; a test pins that picking a
  lens does not resize a document.
- **An empty catalogue is a state no menu has had.** Fit is the fallback and
  the viewport clears a vanished lens; both need a test.
