# 0105 — A notice rides the composition's frame

- **Date:** 2026-11-04
- **Status:** accepted
- **Paths:** `src/web/packages/player/src/chrome.ts`,
  `src/web/packages/player/src/main.ts`,
  `src/web/packages/scene-fabric/src/scene.ts`

## Problem

The display's status and warning strips are `position: fixed` overlays pinned to
the screen's top and bottom edges. A turned composition has no edge there: a
quarter-turned 640×360 board on a 600×800 screen is a 450×800 column, so the
strip ran across it at 90°. Issue #414 reports both the wrong angle and the
reader's expectation that a notice follows the artboard.

The scene is the one owner of where the composition landed. Anything that
depends on that frame must read it rather than re-derive it: a second
derivation of the fit is exactly the class of defect the architecture guardrail
names.

## Rung 1 — internal owner

Searched: `chromeBand`, `putStrip`, `setChromeFrame` (new), `stripInset`,
`showConnectionState`, `showAvailabilityNotice`, `mountFabricScene`,
`computeArtboardTransform`, `ArtboardTransform`, `SceneHandle.transform`,
`updatePresentation`, `fit`, `onFit`.

Found: `scene.ts`'s `fit()` computes and stores `currentTransform`; the handle
exposes `transform()` but only on demand. The player is notified of a
presentation change (`onPresentationChange`) but not of a resize (`ResizeObserver`
inside the scene) or a mount fit. `chrome.ts` owns every strip and already
decides overlay vs in-flow, so the placement rule belongs there.

## Rung 2 — installed dependencies

Searched: Base UI (no chrome primitives), Fabric (canvas viewport transform only),
`@base-ui/react` dialog (unrelated surface).

Found: nothing donates a "track a canvas frame in DOM" mechanism; the scene's own
transform is the only source.

## Rung 3 — native platform

Searched: CSS Transforms Level 1 (`transform`, `transform-origin`), CSS
`position: fixed` containing-block rules, `ResizeObserver`.

Found: a single `rotate()` about the composition's own corner reproduces the
board plate's geometry exactly (the plate already uses `transform-origin: 0 0`).
Fixed positioning has no "viewport edge at an angle" — the strip's frame must be
chosen, not derived from CSS.

## Rung 4 — public solutions

Searched: canvas-overlay chrome patterns (video players, signage players);
`transform-origin` for rotated HUDs; the existing `host-chrome.spec.ts` and
`host-player.spec.ts` rotation fixtures in this repo.

Found: signage players rotate a whole chrome layer with the content; video
players do not rotate chrome at all (their content is never turned). Neither
covers a letterboxed, turned board with an in-flow alternative. The repo's own
phone measurement (`host-chrome.spec.ts`, vg-028) is the binding constraint: an
upright notice stays on the display's edge so it spans the display across the
letterbox.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Rotate the whole chrome layer about the viewport centre | One CSS transform | A non-square viewport maps the edge somewhere inside the screen; the strip floats in the letterbox | Rejected |
| Player re-computes the fit from `handle.transform()` on its own resize/rotation listeners | No scene change | Two derivations of "when the fit happened"; the scene's `ResizeObserver` is private | Rejected |
| Move the strips into the artboard host and turn them with it | Follows the board | Takes room from the composition or re-fits it — the vg-028 defect | Rejected |
| Scene reports every fit (`onFit(transform, artboard)`); chrome places overlay strips on that frame when turned | The scene owns the frame; one placement rule | None for the reported case | Chosen |

## Rung 6 — smallest probe

`host-player.spec.ts` pairs a rect display at 90°, refuses the websocket, and
reads `#yunari-connection`'s style and box against `handle.transform()`: left and
top on the board's mapped corner, width the board's, `rotate(90deg)` and a
translate to the bottom edge. Run with `onFit` removed it fails
(`style.left` `0px` against `525px`); with it, it passes. `host-chrome.spec.ts`
still holds the upright phone to the display's edge.

## Decision

`mountFabricScene` reports each fit through `onFit`, from `fit()` itself so no
path that moves the composition can skip it. `main.ts` converts the transform and
the artboard into a viewport-pixel `ChromeFrame` and hands it to
`setChromeFrame`. `chrome.ts` keeps an upright notice on the display's edge — the
measured phone shape — and puts a turned one on the board's edge at the board's
angle, re-placing strips already up. In-flow strips (the theme chooser) were
untouched: their room still came from the artboard. The chooser now overlays
too — it hides with the display controls, so it is no longer persistent
(0106).
