# Per-display rotation — design

- **Date:** 2026-10-26
- **Status:** draft
- **Related:** [`2026-10-18-per-display-themes-design.md`](2026-10-18-per-display-themes-design.md),
  [`2026-10-26-preview-lens-and-stage-design.md`](2026-10-26-preview-lens-and-stage-design.md),
  [`docs/architecture/ownership.md`](../../architecture/ownership.md),
  [`docs/decisions/0075-a-background-fills-one-of-two-boxes.md`](../../decisions/0075-a-background-fills-one-of-two-boxes.md).

## Purpose

A display's physical mounting decides which way up a theme should be. A phone
fixed to a wall mount is portrait, a television above a bar is landscape, and a
round or square panel has no "right way up" at all. The theme cannot carry this:
the same theme may hang on several displays in different orientations. So the
**display** carries a rotation, and the player renders the theme through it.

The owner's rule:

- a rectangular theme rotates in quarter turns only — `0`, `90`, `180`, `270`;
- a square or circular theme rotates freely through 360°;
- rotation is set from the host's physical-display management and never appears
  in the editor's virtual display.

## Terms

- **Rotation** — whole degrees clockwise, per display record, applied to the
  artboard composition.
- **Rect theme** — an artboard whose width and height differ; its aspect is not
  `1` within `1e-6`.
- **Square/circle theme** — an artboard whose aspect is `1`. A circular
  composition is a square artboard drawn as a disc; the format has no separate
  circle flag, and the host must not invent one.
- **Rotate then fit** — rotate the artboard composition about the display
  centre, then contain-fit its rotated bounding box into the display. Nothing is
  cropped.

## Current state

- `host/src/settings/displays.ts` owns `display-clients.json`:
  `DisplayRecord { id, label, kind, createdAt, lastSeenAt, tokenHash?, monitor?,
  chartFps? }` and `DisplayPatch { label?, chartFps? }`. `normalizePatch` refuses
  what it cannot store. `peerOf` serves a record without its token hash.
- `host/src/server.ts`: `PATCH /api/displays/:id` takes a `DisplayPatch`;
  `/api/themes/active` answers `ActiveDisplay { id, label, kind, theme }` for
  every display (with `this-pc` always first and never from the store); the
  publish poll answers `display: { id, theme, chartFps }`, with
  `chartFpsForDisplay` resolving the record's rate.
- `editor/src/host-settings-mode/region.tsx` draws the Displays section as a
  group of selectable rows; `client.ts` reads the display map and the display
  preferences. The selected row drives the questions below it.
- `player/src/main.ts` mounts the theme through `mountFabricScene` and reads the
  poll through `publish-follower.ts`, applying `chartFps` in place.
- `scene-fabric/src/scene.ts`'s `fit()` calls `computeArtboardTransform`
  (`renderer-core/src/artboard.ts`) — a scale and a translation only — then
  writes `canvas.setViewportTransform([scale, 0, 0, scale, offsetX, offsetY])`
  and calls `media.setBounds({ artboard, display })`. The artboard plate is a
  Fabric background; theme-bounded media is a DOM layer; the display-bounded
  media is the same layer sized to the host.
- Glass sampling reads `BackdropMedia.rect` in artboard units.

## The record

`DisplayRecord` gains:

```ts
rotation?: number; // whole degrees clockwise, 0–359; 0 is omitted
```

`DisplayPatch` gains the same optional field. `normalizePatch`:

- accepts a finite integer `0–359`; `360` normalises to `0`;
- refuses fractions, negatives, `≥ 360` after normalisation, and non-finite
  values — refused, never clamped;
- checks the **step rule** against the theme the display shows at write time:
  a rect theme accepts only `0 | 90 | 180 | 270`, a square/circle theme accepts
  any degree. A display with no theme (neither its own nor the default) is
  treated as rect.

`normalizeRecord` drops a stored rotation it cannot accept, exactly as it drops
an unreadable `chartFps`; the display then plays upright rather than failing.

`this-pc` and `default` are not records: neither can be rotated, and the host
answers `rotation: 0` for them. This PC is the machine the author sits at; the
unpaired client has no identity to key a setting by.

## The step rule

```ts
const FREE_ROTATION = |aspect − 1| <= 1e-6;
const STEP = FREE_ROTATION ? 1 : 90;
```

The host resolves the theme a display shows the same way every other per-display
answer does: its own assignment, else the host's default. A display whose theme
is missing from the store is treated as rect, because no artboard is known.

**A stored angle can become invalid.** If a display holding `45°` on a square
theme is later assigned a 16:9 theme, playback and the control both snap to
`Math.round(angle / 90) * 90 mod 360` (`45 → 90`, `315 → 0`). The stored value is
left alone, so reassigning the square theme restores the author's angle. The
Host row says the angle is being snapped rather than silently showing a
different number.

## The control

Editor → **Host** → **Displays**, for the selected display below its theme row:

- one `ControlSlider` (DESIGN.md §5's bounded number, which already carries a
  value well) labelled `Rotation`;
- rect themes: `min 0`, `max 270`, `step 90`; square/circle themes: `min 0`,
  `max 359`, `step 1`;
- the value box accepts a whole degree and applies the same step rule;
- a display with no rotation stored shows `0°`;
- the control is absent for `this-pc` and for a display with no record (the
  fallback `default`), and the section says why rather than drawing a disabled
  control that cannot be understood.

Writes go through `PATCH /api/displays/:id`; the host's answer is the updated
record, as for label and chart rate. The Host row's read of rotation comes from
`/api/themes/active`, extended with `rotation` per display.

## Playback

**Rotate then fit.** With artboard `w × h` and angle `θ`:

```
w' = |w cos θ| + |h sin θ|
h' = |w sin θ| + |h cos θ|
s  = min(viewport.width / w', viewport.height / h')
```

The canvas transform is the rotation and scale about the artboard centre, then
the translation that centres the rotated bounding box in the display:

```
a = s cos θ,  b = s sin θ,  c = −s sin θ,  d = s cos θ
tx = viewport.width  / 2 − (a·w/2 + c·h/2)
ty = viewport.height / 2 − (b·w/2 + d·h/2)
canvas.setViewportTransform([a, b, c, d, tx, ty])
```

- `computeArtboardTransform` gains `rotation` and returns the angle and the
  rotated-bbox scale; the existing contain result is the `rotation: 0` case, so
  no caller changes behaviour when no rotation is stored.
- **The artboard plate rotates with the canvas** because it is a Fabric
  background image inside it.
- **A theme-bounded media layer rotates with the artboard.** Its box is the
  unrotated artboard rect, placed at the artboard centre and rotated about that
  centre; the layer's own clip is the rotated artboard. `MediaBox` gains an
  optional `angle` (and the layer applies `transform-origin: 50% 50%`).
- **A display-bounded media layer does not rotate.** It fills the display, which
  is the physical frame, not the composition; rotating it would move a
  background instead of orienting a theme. Its box stays the host rect.
- **Glass sampling follows the rotated theme rect**, so a frosted panel over a
  rotated background samples the pixels it actually covers.
- The degenerate-viewport path is unchanged; a zero-area display draws nothing.

**Delivery.** The existing publish poll answer becomes
`display: { id, theme, chartFps, rotation }`. `publish-follower.ts` applies the
angle in place when it changes, the way it already applies `chartFps`, and the
scene handle gains the one writer for it (`updateRotation`). The first frame
before the poll arrives is upright, then the angle lands — the same one-frame
behaviour the chart rate already has and accepts.

## Out of scope

- Rotation in the editor's virtual display: the author's screen is upright.
- A persisted circle/square flag on the theme; the artboard's aspect decides.
- Rotating the unpaired `default` client or `this-pc`.
- Rotation of individual layers; this turns the whole composition.
- Any theme schema change.

## Acceptance

1. On a display record, `PATCH /api/displays/:id` with `rotation: 90` stores 90,
   answers it in the record and in `/api/themes/active`, and a reload keeps it.
2. `rotation: 45` is refused for a rect theme with a visible reason, and accepted
   for a square theme.
3. `rotation: 360` stores 0; `rotation: -1`, `90.5` and `"90"` are refused.
4. The Host control shows quarter-turn steps for a rect theme and whole-degree
   steps for a square theme; the slider and the well write the same value.
5. The player renders a 90° rect theme rotated and contain-fitted — a 16:9 theme
   on a portrait viewport fills the height and letterboxes left and right — with
   no crop; a square theme at 45° is fully visible inside the display.
6. A theme-bounded background rotates with the artboard; a display-bounded
   background keeps filling the display and does not rotate.
7. A glass panel over a rotated theme samples the rotated position (visible
   behaviour, checked in the browser against the panel's painted pixels, not
   only its geometry).
8. Reassigning a rect theme to a display holding 45° snaps playback and the
   control to 90°, says so in the Host row, and restoring the square theme
   restores 45°.
9. `this-pc` and the unpaired default have no rotation control and play upright.

## Risks

- **Rotation changes the renderer-core transform contract**, which the editor
  also reads for its artboard rect. The editor always passes no rotation, so its
  behaviour is the existing `rotation: 0` path; a test pins that the editor's
  rect is unchanged.
- **Two media behaviours in one layer** (rotating theme-bounded, fixed
  display-bounded) is subtle. It is a deliberate distinction and needs a browser
  test per case, because neither fails visibly in unit geometry alone.
- **A web page cannot rotate the physical panel.** This rotates the composition
  to suit the mounting; the browser's own orientation lock is a separate,
  platform-gated capability and is not claimed here.
- **A stored free angle on a now-rect theme is snapped, not erased.** That is
  reversible but means the stored value and the played value can differ; the
  Host row has to say so, or the number reads as a bug.
