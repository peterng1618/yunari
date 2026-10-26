# Per-display shape and rotation — design

- **Date:** 2026-10-26
- **Status:** draft
- **Related:** [`2026-10-18-per-display-themes-design.md`](2026-10-18-per-display-themes-design.md),
  [`2026-10-26-preview-lens-and-stage-design.md`](2026-10-26-preview-lens-and-stage-design.md),
  [`docs/architecture/ownership.md`](../../architecture/ownership.md),
  [`docs/decisions/0075-a-background-fills-one-of-two-boxes.md`](../../decisions/0075-a-background-fills-one-of-two-boxes.md).

## Purpose

A display's physical mounting decides which way up a theme should be and what
shape the screen is. A phone fixed to a wall mount is portrait and cannot be
turned; a round panel has no "right way up"; a television is landscape. None of
this belongs to the theme, because the same theme may hang on several displays.

So **the display record** carries:

- **shape** — `rect` or `circle`, chosen when the display pairs and editable
  afterwards;
- **rotation** — whole degrees clockwise, quarter turns on a rectangular display
  and free through 360° on a circular one.

Any rectangular theme, square included, must contain-fit inside a circular
display with all four of its corners on the circle. Rotation is a playback
setting: it is never a property of the editor's virtual display, and never
enters a theme envelope.

## Terms

- **Rect display** — a rectangular panel.
- **Circle display** — a round panel. The player presents a disc of diameter
  `min(viewport.width, viewport.height)`, centred.
- **Inscribed fit** — the artboard is scaled so its four corners lie on the
  circle: for an artboard `w × h` and disc diameter `d`,
  `scale = d / hypot(w, h)`. A rectangle's diagonal does not change when it
  rotates, so a circle display's scale is independent of its rotation.
- **Rotate then fit** — on a rect display, rotate the artboard composition about
  the display centre, then contain-fit its rotated bounding box into the
  display. Nothing is cropped.

## Current state

- `host/src/settings/displays.ts` owns `display-clients.json`:
  `DisplayRecord { id, label, kind, createdAt, lastSeenAt, tokenHash?, monitor?,
  chartFps? }`, `DisplayPatch { label?, chartFps? }`, and the creation paths
  `create(label, token)` (a claimed device) and `createLocal(label, monitor)`
  (a monitor of this machine). `normalizeRecord` drops what the file cannot
  hold; `normalizePatch` refuses what a write cannot store.
- `host/public/pair.html` is opened **on the unpaired device**. Its claim body is
  `{ code, label }` posted to `/api/pairing/claim`; the host mints the record
  with `displays.create`.
- `host/src/server.ts`: `POST /api/displays` creates a local display from
  `{ label, monitor }`; `PATCH /api/displays/:id` takes a `DisplayPatch`;
  `/api/themes/active` answers `ActiveDisplay { id, label, kind, theme }` for
  every display, with `this-pc` first and never from the store; the publish poll
  answers `display: { id, theme, chartFps }`.
- `editor/src/host-settings-mode/region.tsx` draws the Displays section as
  selectable rows; `client.ts` reads the map. The selected row drives the
  controls below it.
- `player/src/main.ts` mounts the theme through `mountFabricScene`; the poll in
  `publish-follower.ts` applies `chartFps` in place.
- `scene-fabric/src/scene.ts`'s `fit()` calls `computeArtboardTransform`
  (`renderer-core/src/artboard.ts` — scale and translation only), writes
  `canvas.setViewportTransform([scale, 0, 0, scale, offsetX, offsetY])`, and
  calls `media.setBounds({ artboard, display })`. Theme-bounded media is a DOM
  layer; display-bounded media is the same layer sized to the host.
- Glass sampling reads `BackdropMedia.rect` in artboard units.

## The record

`DisplayRecord` gains:

```ts
shape: "rect" | "circle";   // default "rect"
rotation?: number;          // whole degrees clockwise, 0–359; 0 is omitted
```

`DisplayPatch` gains both as optional fields. Both are set at creation and
editable afterwards; neither touches the id.

**Creation.** Both paths accept the fields optionally:

- `POST /api/pairing/claim` body gains `shape?` and `rotation?`, sent by the
  pairing page;
- `POST /api/displays` (local monitor) body gains the same two fields.

Absent means `shape: "rect"`, `rotation: 0`. An unknown shape is refused, not
defaulted. Rotation is validated against the **shape in the same request**, so
creation needs no theme lookup.

**Reading.** `normalizeRecord` reads an unknown `shape` as `rect` and drops a
rotation the shape cannot hold — the display then plays upright rather than
failing, exactly as an unreadable `chartFps` falls back to the kind's default.

`this-pc` and `default` are not records: neither has a shape or rotation, and
the host answers `rect` / `0` for them.

## The step rule

```ts
const shape = record.shape ?? "rect";
const allowed = shape === "circle"
  ? (rotation) => Number.isInteger(rotation) && rotation >= 0 && rotation < 360
  : (rotation) => rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270;
```

- A rect display accepts quarter turns only.
- A circle display accepts any whole degree; `360` normalises to `0`.
- Fractions, negatives, non-finite values and non-numbers are refused, never
  clamped.
- **Changing the shape snaps the stored rotation into the new rule**, with
  `Math.round(rotation / 90) * 90 mod 360` for `rect`. A patch that names both
  fields is applied as one: the new shape decides the rule the new rotation must
  satisfy.

Because the rule reads the display's shape and nothing else, no theme store is
consulted on a write and a later theme assignment cannot invalidate a stored
angle. A display swapped from round to rectangular keeps a snapped quarter turn;
swapping back does not restore a lost free angle, which is the one destructive
part and is named in the control's label.

## Pairing and the pair page

`pair.html` gains two controls beside the code and label:

- **Screen shape** — `Rect` / `Circle`;
- **Starting rotation** — a number field whose step follows the shape (90 for
  Rect, 1 for Circle), defaulting to 0.

Both are sent in the claim body. The claim route validates them with the same
normaliser the record write uses, so a device cannot write a record the store
would later drop. The page's own defaults are `Rect` and 0, so a device that
knows nothing about its panel — or an older page — still pairs.

## The control

Editor → **Host** → **Displays**, for the selected display below its theme row:

- **Shape** — `ControlSegmented` with `Rect` and `Circle`, writing `shape`;
- **Rotation** — `ControlSlider` (DESIGN.md §5's bounded number, which already
  carries a value well) labelled `Rotation`; `min 0`, `max 270`, `step 90` for a
  rect display and `min 0`, `max 359`, `step 1` for a circle display;
- the value box accepts a whole degree and applies the same rule;
- a display with no rotation stored shows `0°`;
- changing the shape re-derives the rotation control in the same render, and a
  rotation the new shape cannot hold is snapped by the write;
- the controls are absent for `this-pc` and the unpaired `default`, with the
  section saying why rather than drawing a disabled control.

Writes go through `PATCH /api/displays/:id`; the host's answer is the updated
record. The Host row reads shape and rotation from `/api/themes/active`,
extended with both fields per display.

## Playback

### A rect display

With artboard `w × h`, angle `θ`, viewport `V`:

```
w' = |w cos θ| + |h sin θ|
h' = |w sin θ| + |h cos θ|
s  = min(V.width / w', V.height / h')
a = s cos θ,  b = s sin θ,  c = −s sin θ,  d = s cos θ
tx = V.width  / 2 − (a·w/2 + c·h/2)
ty = V.height / 2 − (b·w/2 + d·h/2)
canvas.setViewportTransform([a, b, c, d, tx, ty])
```

`computeArtboardTransform` gains a `rotation` input and returns the angle with
the rotated-bbox scale; `rotation: 0` is exactly today's result.

### A circle display

```
d     = min(V.width, V.height)
s     = d / hypot(w, h)                 // corners on the circle
θ     = rotation                        // free
a = s cos θ,  b = s sin θ,  c = −s sin θ,  d' = s cos θ
tx = V.width  / 2 − (a·w/2 + c·h/2)
ty = V.height / 2 − (b·w/2 + d'·h/2)
```

The scale does not depend on the angle, so spinning a theme on a round panel
turns it in place without growing or shrinking the composition.

- The display's disc is `min(V.width, V.height)` wide, centred. The player
  paints it with the theme's background colour and clips the canvas and the
  media layers to `border-radius: 50%`; the area outside the disc is black (on
  a round panel it is outside the screen).
- **The artboard plate does not rotate.** It is not a Fabric background: the
  preview-lens plan made one paint serve the board's fill and the bars behind
  it, and that paint is CSS on the host (rect) or on the disc (circle). Only the
  composition, a theme-bounded media layer and glass sampling turn. A gradient
  plate therefore stays screen-fixed under a turned composition; `vg-759` owns
  that open question.
- **A theme-bounded media layer rotates with the artboard.** Its box is the
  unrotated artboard rect, placed at the artboard centre and rotated about that
  centre; the layer's clip is the rotated artboard. `MediaBox` gains an optional
  `angle`.
- **A display-bounded media layer fills the disc and does not rotate.** It is
  the display's fill, not the composition.
- **Glass sampling follows the rotated theme rect**, in both display shapes, so
  a frosted panel samples the pixels it actually covers.
- The degenerate-viewport path is unchanged.

### Delivery

The existing publish poll answer becomes
`display: { id, theme, chartFps, shape, rotation }`. `publish-follower.ts`
applies shape and angle in place when they change, the way it applies
`chartFps`; the scene handle gains the one writer (`updatePresentation`). The
first frame before the poll arrives is rect/upright, then the presentation
lands — the same one-frame behaviour the chart rate already has and accepts.

## Out of scope

- Rotation or shape in the editor's virtual display: the author's screen is
  upright, and the editor's own circle lens is a separate preview feature.
- A persisted circle or square flag on the theme.
- Presentation for the unpaired `default` client or `this-pc`.
- Rotation of individual layers; this turns the whole composition.
- Any theme schema change.

## Acceptance

1. On a display record, `PATCH /api/displays/:id` with `rotation: 90` stores 90,
   answers it in the record and in `/api/themes/active`, and a reload keeps it.
2. `rotation: 45` is refused for a rect display; `shape: "circle"` with
   `rotation: 45` is accepted, and `360` stores 0.
3. `rotation: -1`, `90.5`, `"90"` and `shape: "round"` are refused with a
   visible reason.
4. The pair page sends shape and starting rotation in the claim; a claim with
   `shape: "circle", rotation: 45` produces that record, and a claim without
   them produces `rect` / 0.
5. The Host control shows quarter-turn steps for a rect display and whole-degree
   steps for a circle display; the slider and the well write the same value;
   changing the shape changes the steps and snaps a stored free angle.
6. A 16:9 theme on a rect display at 90° is rendered rotated and contain-fitted
   — fills the height of a portrait viewport and letterboxes left and right —
   with no crop.
7. On a circle display, any rect theme's four corners lie on the disc, at 0° and
   at 45°, measured from the rendered geometry; nothing is cropped.
8. A theme-bounded background rotates with the artboard; a display-bounded
   background fills the disc and does not rotate.
9. A glass panel over a rotated theme samples the rotated position (checked
   against the panel's painted pixels in the browser, not only its geometry).
10. `this-pc` and the unpaired default have no shape or rotation control and
    play rect/upright.

## Risks

- **Rotation changes the renderer-core transform contract**, which the editor
  also reads for its artboard rect. The editor always passes no rotation and a
  rect display, so its behaviour is the existing path; a test pins that.
- **Two media behaviours in one layer** (rotating theme-bounded, fixed
  display-bounded) is subtle. It is deliberate and needs a browser test per
  case, because neither fails visibly in unit geometry alone.
- **A shape change can destroy a free angle.** Snapping is the rule; the control
  says so rather than leaving the author to discover it.
- **A web page cannot rotate the physical panel.** This rotates the composition
  to suit the mounting; the browser's own orientation lock is a separate,
  platform-gated capability and is not claimed here.
- **A circle display's disc is a presentation choice inside a rectangular
  viewport.** On a genuinely round panel the corners are outside the glass and
  invisible; in a browser preview they are black, which is the honest rendering.
