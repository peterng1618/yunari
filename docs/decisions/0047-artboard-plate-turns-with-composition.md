# 0047 — The artboard plate turns with the composition; the letterbox is its own fill

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/scene.ts`,
  `src/web/packages/scene-fabric/src/artboard-backdrop.ts`

## Problem

GitHub #239 (`vg-759`). On a turned display the composition, a theme-bounded
media layer and the glass sample all carry the mount angle, but the artboard's
own paint is written as CSS on the host (rect) or on the disc (circle). That CSS
is screen-fixed, and the canvas background stays cleared because a fill there
would sit above the media layer. A solid paint hides the defect; a gradient
theme shows a screen-fixed plate under a turned composition. The plate also
feeds the glass backdrop, so the sampler has the same wrong picture.

## Rung 1 — internal owner

Searched: `codegraph explore "applyPresentation artboardBackdrop surfacePlate
fit displayBox presentationDisc"`, plus the source of `scene.ts`,
`artboard-backdrop.ts`, `artboard-paint.ts`, `glass.ts` and their DOM suites.

Found: one chain already owns the turn. `computeArtboardTransform` produces
`rotation`; `fit()` passes it to the artboard `MediaBox` and to the media
layer; `artboardBackdrop` already receives `angle`; `glass.ts` rotates a
sampled backdrop about its mapped centre. The plate is the only surface on that
chain that discards it. `applyPresentation` writes the paint to the host/disc
and `surfacePlate` paints the same paint mapped to the display box, so both
halves are screen-fixed.

## Rung 2 — installed dependencies

Searched: `StaticCanvas` viewport transforms, `background-media.place()` and
its `MediaBox.angle`/`angleOrigin`, the Fabric `Gradient` path, and ADR-0012
(display-bounded media turns with the mount).

Found: Fabric already rotates the composition in the canvas matrix, and the
existing `MediaBox` carries exactly the corner-origin rotation the artboard
needs. The DOM media layer is the precedent for a turned sibling: it is placed
at the mapped artboard box with `transform-origin: 0 0`. No dependency donates a
second plate rotation, but nothing needs inventing either.

## Rung 3 — native platform

Searched: MDN `transform-origin`, `rotate()`, CSS `linear-gradient` sizing, and
Canvas 2D `clip()`/`rotate()`.

Found: a CSS element sized to the artboard box, with `transform-origin: 0 0`
and `rotate(angle)`, is the same quad the canvas matrix produces; a
`linear-gradient` on that element maps to the artboard box before the element
turns. Canvas 2D can clip the sampled board box and let the existing backdrop
rotation carry it. The platform does not decide the bar fill; that is ours.

## Rung 4 — public solutions

Searched: "digital signage rotate screen background with overlay", "BrightSign
roVideoMode rotation", "MDN CSS linear-gradient background-size" and the
prior art already recorded in ADR-0012.

Found: BrightSign's `roVideoMode.transform` and Wunderframe's mounting docs both
state the invariant that a turned output rotates everything it shows, video
included. Neither exposes a separated "plate" concept, so the split — content
rotates, the letterbox fill stays with the screen — is ours to state. MDN
confirms the CSS forms used, nothing about composition order.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Rotate an artboard-sized DOM plate above the host fill, under the media; keep the host/disc fill as the screen-fixed bars | reuses `MediaBox`'s corner rotation and the media layer's own placement | one extra DOM element and backdrop clip | **chosen** |
| Fill the canvas with the plate | actually rotates for free | the canvas is above the media, so the fill hides it — the rule this repo already removed | rejected |
| Rotate the host background itself | one node | the host is the screen; rotating it rotates the letterbox too and leaves its corners uncovered | rejected |
| Keep the plate screen-fixed and document it | no code | contradicts the composition rule and leaves a visible gradient mismatch | rejected |
| Sample the plate from the DOM element | one picture in both paths | the canvas sampler cannot read a DOM sibling without a second capture per frame | rejected |

## Rung 6 — smallest probe

`scene-presentation.dom.test.ts` samples a two-tone host paint through a glass
panel under a 90° presentation: before this change it reads the screen's left
(red) half at a point the turned board paints blue. The same suite probes two
letterbox points outside the rotated board quad, which must still read the
screen-fixed gradient. `glass.dom.test.ts`'s two plate cases are the isolated
form of the same reading. Both fail before the change and pass after.

## Decision

`scene.ts` creates a pointer-transparent DOM plate sized to the artboard's
mapped box and turns it with the composition matrix (the same box and angle the
media layer already uses). The host (rect) or disc (circle) keeps the paint as
the screen-fixed letterbox fill. `artboard-backdrop.ts` paints the board's own
paint under the media, clipped to the mapped board box, so the existing backdrop
rotation turns it; `surfacePlate` stays the screen-fixed fill composited beneath
it. `renderer-core` is untouched, and Fabric ownership stays one-way.
