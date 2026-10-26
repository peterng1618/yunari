# 0125 — A presentation is a clip, a mirrored matrix and a turned sample

- **Date:** 2026-10-26
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/scene.ts`,
  `src/web/packages/scene-fabric/src/background-media.ts`,
  `src/web/packages/scene-fabric/src/glass.ts`,
  `src/web/packages/scene-fabric/src/artboard-backdrop.ts`

## The problem

0124 gave the transform a rotation and a matrix. Three consumers now have to
present it, and each has a different native form: the Fabric canvas takes a
viewport matrix, the background media is a DOM element, and a glass panel
samples pixels from a scratch surface. A wrong choice in any of them renders a
composition that is plausible and wrong — the composition rotated but its
wallpaper upright, or a disc-shaped plate whose corners still show — and
nothing throws.

Two sub-problems were not obvious:

1. **The disc.** A Fabric canvas is a rectangle whose painted content is the
   composition. `border-radius` rounds the *element*, leaving the plate's
   corners painted inside the rounded box; a round display must clip the
   canvas, not decorate it.
2. **The media layer's rotation origin.** The scene's artboard box is
   `{offsetX, offsetY, w·s, h·s}` — the transform's own placement of the
   artboard's top-left. Rotating that box about its CSS-default centre moves a
   turned board off the composition, because `offsetX/offsetY` already carry
   the rotation's shift.

## Rung 1 — Yunari

Searched: `computeArtboardTransform` and its consumers, `scene.ts`'s `fit()`,
`background-media.ts`'s `place()`/`backdrop()`, `glass.ts`'s `backdropFor`,
`artboard-backdrop.ts`, decisions 0001, 0012, 0075, 0079, 0080, 0124.
Found: the canvas already has a Fabric `clipPath` sized to the artboard
(`adapter.ts`), which turns with the viewport; the media layer already carries
`radius?: "circle"` for a display-bounded box (Plan A), and `bounds: "display"`
is expressed in artboard units and scaled into device pixels by the sampler.
No owner presented a rotation.

## Rung 2 — dependencies

Searched: `src/web/packages/scene-fabric/package.json` and the workspace root;
`fabric/util` matrix helpers.
Found: nothing needed. A 2×3 matrix is spread into `setViewportTransform`, a
CSS `rotate()` string is a template literal, and the sampler's turn is one
`ctx.rotate`. No new dependency.

## Rung 3 — platform

Searched: CSS `clip-path: circle()`, `transform-origin`, Canvas 2D
`rotate()`/`setTransform`, Fabric 7's `viewportTransform` (0124 recorded the
rotated-viewport caveat, fabricjs/fabric.js#10976).
Found: `clip-path` clips painted content and accepts a circle with an explicit
centre, which is what a round panel needs. A CSS `rotate()` with
`transform-origin: 0 0` maps local coordinates exactly as the canvas matrix's
rotational part does, so the DOM layer and the canvas cannot disagree about a
turned board. `ctx.rotate` on the glass scratch reproduces the canvas's own
turn.

## Rung 4 — ecosystem

Searched: the repo's decisions and the Fabric transformation guide; no web
query was needed, because the mechanism is three platform calls rather than a
library shape.
Found: the common recipe for a round surface is `border-radius` on a DOM box —
correct for a DOM image, wrong for a canvas whose paint must be clipped. The
rotation-origin mistake is common in CSS media layers that place a box by its
top-left and then rotate about its centre.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| `border-radius` on the canvas element | Rounds the element only | One property | Plate corners show inside the disc | Rejected |
| `clip-path: circle()` on the canvas | Clips the painted composition | One property | None measured | **Chosen** |
| Media box: rotate about the element centre | Wrong for a rotated non-square board | None | Board sits off-centre at every non-zero angle except a square | Rejected |
| Media box: `transform-origin: 0 0` | Matches the canvas matrix exactly | One property | None | **Chosen** |
| Sampler: map the rect's corners | Axis-aligned box at the unrotated corner | None | Sample is displaced once the plane turns | Rejected |
| Sampler: map the rect's centre, scale by `hypot(a, b)`, rotate the scratch | The composed rect exactly | Save/rotate/restore | None | **Chosen** |

## Rung 6 — probe

Unit measurements, not a browser:

- 400×300 board in a 400×300 host at 90°: viewport `[≈0, 1, -1, ≈0, 300, 0]`;
  the matrix's two diagonal terms are 0 to 9 decimal places.
- A two-tone 200×200 backdrop with a panel centred at (140, 120): upright it
  reads the right (blue) half; at 180° the same device pixel reads the left
  (red) half. The pixel case is `glass.dom.test.ts`.
- A display-bounded layer through a 90° plane reports device
  `{0, 0, 200, 200}` (its own host box); letting the board's rect drive it
  gives `{-100, 100, 200, 200}`.

## Decision

- The disc is the canvas element's `clip-path`, with its paint on a DOM div
  behind the media layer and black outside it. A display-bounded media layer
  keeps `border-radius`, because it is a real DOM box that fills the host.
- The media layer is placed at the transform's own `offsetX/offsetY` and turned
  with `transform-origin: 0 0`, so its CSS transform is the canvas matrix's
  rotational part rather than a second, centre-based mapping.
- The sampler maps the media rect's centre through the full plane, scales by
  `Math.hypot(plane[0], plane[1])`, and turns the scratch about that centre.
  A display-bounded layer reports `screenRect` in host pixels instead and is
  never turned by the sampler; `artboard-backdrop.ts` forwards both so the
  wrapper cannot re-map a box it does not own.
- No presentation is today's behaviour: rect, upright, no disc, no clip, and
  angle 0 on every path that now carries one.
