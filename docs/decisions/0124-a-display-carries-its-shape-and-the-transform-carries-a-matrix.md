# 0124 — A display carries its shape and the transform carries a matrix

- **Date:** 2026-10-26
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/artboard.ts`, `src/web/packages/renderer-core/src/artboard.test.ts`, `src/web/packages/renderer-core/src/index.ts`, `src/web/packages/host/src/settings/displays.ts`, `src/web/packages/host/src/server.ts`

## The problem

A display's physical mounting decides which way up a theme plays and what shape
the glass is. Playback must rotate the whole composition (never a layer, never
the theme), contain-fit the rotated bounding box on a rectangular panel, and
inscribe the artboard's four corners on a round one. The transform owner today
is a uniform scale plus a translation; two independent consumers already read
it (`scene-fabric/src/scene.ts` for Fabric's viewport, the player's media layer
for the artboard box), so the change must keep every existing field meaning
what it meant and still be expressible by Fabric.

The non-obvious part is not the trigonometry; it is **where the rotation
lives**. A CSS `rotate()` on a wrapper, a Fabric object angle, and six numbers
on the viewport are three different owners, and only one of them can also
answer the inverse mapping and the degenerate-viewport case the existing
contract already answers.

## Rung 1 — Yunari

Searched: `computeArtboardTransform` and every consumer (`rg` across
`src/web/packages`), `ArtboardTransform`, `toCssTransform`,
`documentToViewport`/`viewportToDocument`, `transform()` on `SceneHandle`, the
`bars`/`crop` fields.
Found: `renderer-core/src/artboard.ts` is the single owner; `scene.ts`
`fit()` writes `canvas.setViewportTransform([scale, 0, 0, scale, offsetX,
offsetY])` and a media `setBounds` from `offsetX`/`offsetY`/`scale`;
`SceneHandle.transform()` returns it; the editor reads it for its artboard
rect but always upright. Per-object `angle` exists in `scene/plan.ts` and
`scene-fabric` (`authored-box.ts`, `placement.ts`) but is object-level, not a
composition transform. Nothing rotates an artboard. `bars` has no production
consumer outside the transform itself.

## Rung 2 — dependencies

Searched: workspace manifests under `src/web/packages/*/package.json` and the
root `src/web/package.json` for a matrix/geometry dependency.
Found: nothing that owns this. Fabric's `fabric.util` matrix helpers are
already installed and available to `scene-fabric`, but they operate on Fabric
objects and a 2×3 array we would have to hand back anyway. No 2D affine package
is installed, and a six-number matrix is a few sums.

## Rung 3 — platform

Searched: Fabric 7 `Canvas#setViewportTransform` / `viewportTransform` docs;
CSS Transforms spec and `object-fit`/`transform` interaction.
Found: Fabric's viewport transform **is** a Canvas 2D transform matrix —
`[a, b, c, d, tx, ty]` — so a rotated fit needs no second transform layer.
Platform warning recorded by Fabric itself: `getZoom()` and control maths
assume `vpt[0]` is the scale and `vpt[1] === 0`
([fabricjs/fabric.js#10976](https://github.com/fabricjs/fabric.js/issues/10976));
a rotated viewport is accepted and rendered, but the selection helpers are
wrong. The player has no selection, so that is a later-task constraint, not a
reason to reject the matrix. CSS `transform` never affects layout and
`object-fit` cannot express "rotate then fit"; a CSS wrapper would need the
same arithmetic computed in JS anyway.

## Rung 4 — ecosystem

Searched: "CSS rotate element then contain fit rotated bounding box inside
container", "width and height of rotated elements", Stack Overflow's
"CSS rotate element while staying inside container", Fabric's transformation
guide.
Found: the convention is exactly rotate-then-fit, and everyone computes the
same rotated bounding box `w' = |w cos θ| + |h sin θ|`,
`h' = |w sin θ| + |h cos θ|` before a contain/cover scale. The accepted
Stack Overflow answer goes further and continuously rescales so the rotated
element stays inside a fixed frame; that is the same result the matrix gives,
but expressed as a CSS `rotate() scale()` pair with the translation left
implicit. Nobody ships a library for this shape because the arithmetic is
shorter than the call site. No ecosystem answer handles the inscribed-circle
case (corners on the circle), which is why `scale = d / hypot(w, h)` is written
here rather than searched for.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep `scale`+offsets, add `rotation`; consumers keep reading old fields | Partial: media bounds stay unrotated | One field | A consumer that forgets `rotation` renders upright with no error | Rejected as the only answer |
| Return a full 2×3 matrix beside the existing fields | Exact: Fabric takes the matrix, media can use it later, inverse is the matrix inverse | One 6-number array | Two ways to read the same transform | **Chosen** |
| CSS wrapper with `rotate()` on the host element | Same numbers, computed in JS | A DOM element and a second transform origin | Second owner of the mapping; player and editor disagree | Rejected |
| Fabric per-object angle on the artboard group | No new contract | Every child's transform, media layer excluded | Composition rotation is not an object property; breaks media/glass | Rejected |

## Rung 6 — probe

Measured in Node against the formula, not by inspection: artboard 1600×900
into viewport 600×800 at 90°. `w' = 900`, `h' = 1600`, so
`scale = min(600/900, 800/1600) = 0.5`; the rotated box is 450×800, leaving
75 px letterbox per side horizontally and 0 vertically, and the matrix is
`[0, 0.5, −0.5, 0, 525, 0]`. At 0° the same call returns
`[0.5, 0, 0, 0.5, 0, 75]` — today's `scale` and offsets exactly.
A 45° inscribed circle of diameter `min(600,800) = 600` on the same artboard
gives `scale = 600 / hypot(1600,900) = 0.326841…`; all four mapped corners sit
at distance 300.0 from the viewport centre.

## Decision

The transform returns **both** the existing fields and a full 2×3 matrix, and
the rotation angle that produced it. The matrix is the one representation that
Fabric consumes directly, that inverts exactly for `viewportToDocument`, and
that can describe a circle's inscribed fit as well as a rect's rotated
contain-fit. `scale`, `offsetX` and `offsetY` are kept as projections of the
matrix so the editor and the existing media bounds keep working unchanged at
`rotation: 0`, which the spec requires to be byte-for-byte today's result.
Rotation is validated at the display record (its owner); the transform only
refuses a number that cannot be a whole degree in the display's allowed set,
because silently clamping an invalid angle would render a theme nobody asked
for and hide the defect.

The host keeps that same owner: `settings/displays.ts`'s `normalizePresentation`
is the one rule the claim route, the local-display route and a patch all ask,
and the routes only translate its refusal into a 400 with the store's own
sentence. The rule lives in the store rather than in a route because the file is
what a reader normalises on the next start; a rule owned per route would let one
path write a record the store's own reader then drops.
