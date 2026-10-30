# 0012 — A display-bounded media layer turns with the mount angle

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/scene.ts`,
  `src/web/packages/scene-fabric/src/background-media.ts`,
  `src/web/packages/scene-fabric/src/glass.ts`

## Problem

A display mounted at 90° shows its overlay upright — the composition's canvas
matrix carries the mount angle — while a background video with
`media.bounds: "display"` shows 90° counter-clockwise. Measured on the attached
Kraken Z73 (320×320, display record `rotation: 90`, theme "Turzx Circle", video
`bounds: "display"`): the readings card is upright and the clip is not, and
changing the display's rotation moves the overlay but never the clip.

The cause is ownership, not arithmetic. `background-media.ts` sizes a
display-bounded layer to `bounds.display`, and `scene.ts` built that box with
no angle on the stated rule "a display layer fills the host box and must not
turn". The rule is right for the *paint* — the disc or the letterbox belongs to
the screen and stays put — and wrong for the *content*: the mount angle turns
everything the screen shows.

## Rung 1 — internal owner

Searched: `codegraph explore "displayBox applyPresentation presentationDisc fit
setBounds place backdrop angle"` and the `MediaBox` / `MediaBounds` /
`BackdropMedia` types.

Found: one chain already owns the turn. `computeArtboardTransform` produces
`rotation`; `fit()` passes it to the artboard box as `angle`; `place()` turns a
box about its top-left corner; `backdrop()` and `glass.ts` turn the sampled
copy about the box's centre. The display box is the only box on that chain
without an angle, and the only box whose corner is not the rotation pivot — it
is the screen, so its pivot is its centre. The change is to state that pivot in
the box rather than to add a second placement path.

## Rung 2 — installed dependencies

Searched: Fabric's `StaticCanvas` viewport transform and the DOM layer beside
it (`scene.ts`, `background-media.ts` tests).

Found: Fabric already rotates the composition (`setViewportTransform`); it
cannot see the media `<video>`, which is a DOM sibling. The CSS transform on
that sibling is therefore the only way the clip can follow. Nothing in Fabric
or the repo donates a second rotation.

## Rung 3 — native platform

Searched: MDN `transform-origin` / `rotate()` and the Canvas 2D `rotate()`
used by `glass.ts`.

Found: `transform-origin` defaults to `50% 50%`; a positive `rotate(θ)` is
clockwise in left-to-right text. Setting `transform-origin: 0 0` and the same
angle is exactly the corner pivot the artboard box already uses. Canvas 2D
offers the same pivot by translating to it, rotating and translating back —
which `glass.ts` already does about the device rect's centre. The platform
leaves the coverage question unsolved: a turned screen-filling box must be
larger than the glass or its corners show black.

## Rung 4 — public solutions

Searched: "digital signage display mount rotation video background rotate with
overlay implementation"; MDN CSS transform pages.

Found: BrightSign's `roVideoMode.transform` states the invariant — a turned
screen "rotates all of the content including video", and a 1920×1080 screen at
90 runs as 1080×1920 with video and graphics both rotated. Wunderframe's
mounting docs say the player "turns everything it shows, video included", and
the screen itself needs no setting. Both are whole-output rotations, not
per-widget ones; BrightSign's older per-widget `rot90` is described as the
route that makes widgets disagree. That is the failure observed here.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Turn the display box about its centre | The box is already the layer's own geometry and reach; one pivot field | Coverage box for a rect display | **Implement** |
| Rotate the layer's child instead | Same visual for a circle; a rect display would need the child enlarged by hand | A second placement path and a second clip | Reject |
| Pre-rotate the frame in the panel driver | The panel driver already declines rotation | Double rotation with the player's own matrix, per-panel duplication | Reject |
| Rotate inside the video element (CSS on the child) | Nothing gained over the layer | Same coverage work | Reject |

The coverage box is arithmetic, not a new mechanism: for a quarter turn the
unrotated box is the viewport with its edges swapped and centred, so after the
turn it covers the glass exactly. A circle display's box is the disc's square,
which maps onto itself.

## Rung 6 — smallest probe

The rotation is observable without hardware: `glass.dom.test.ts` already
samples a two-tone backdrop through a glass panel, and a display-bounded
backdrop carrying a 90° angle must read the upright left half as the top half.
The attached Kraken then confirms the DOM layer, which is the half a glass
panel does not read.

## Decision

`MediaBox` gains `angleOrigin?: "corner" | "centre"` — `corner` is the
composition box's existing behaviour, `centre` is the screen's. `displayBox`
takes the mount angle and returns the screen box with the angle, for a rect
display swapped and centred so the turn still covers the glass.
`background-media.place()` sets `transform-origin` from that field, and
`backdrop()` reports the display angle so the glass sampler turns with it.
`glass.ts` turns a screen-bounded sample about the screen box's centre instead
of forcing the angle to zero.

The display's own paint surface is unchanged: the disc and the letterbox still
belong to the screen and do not turn.
