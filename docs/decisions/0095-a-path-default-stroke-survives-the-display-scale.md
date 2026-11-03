# 0095 — A path's default stroke survives the artboard's display scale

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/mcp/src/tools/compose.ts`

## Problem

`add_shape` with `kind: "path"` and no `strokeWidth` writes 2 artboard units.
Fabric scales a stroke with the artboard, so on a 1920-wide theme shown on a
320 px display that line is a third of a pixel and reads as absent; the author
rebuilds the rule as a filled rect instead. The path is valid, persisted and
painted — it is simply below the display's resolution, so nothing reports the
problem.

## Rung 1 — internal owner

Searched: CodeGraph for `addShapeObject`, `path`, `strokeWidth`, and every
`add_shape` caller.

Found: `theme-kit`'s `path()` owns the primitive and its 2-unit default;
`mcp/tools/compose.ts` is the only caller, and it already knows the draft's
artboard. The editor authors its own paths through Fabric and its stroke field,
so the MCP default is the one to move; changing the primitive's default would
also change any future Node-side caller that does know its own scale.

## Rung 2 — installed dependencies

Searched: Fabric 7 `Path` and `strokeWidth` handling; the starter's authored
paths.

Found: `strokeWidth` is in artboard units and is transformed with the object
and the artboard, which is why a value chosen for a full-size canvas vanishes
in a panel preview. Fabric has no "screen-space width" option for a shared
scene: `strokeUniform` keeps the ratio of stroke to object scale, not to the
viewport, so it does not address the display's own scale. Nothing in the
dependency donates a display-aware default.

## Rung 3 — native platform

Searched: Canvas 2D line widths and `devicePixelRatio`; the player's artboard
transform.

Found: the platform draws sub-pixel strokes with partial coverage, so they
fade rather than disappear — the observed faint hairline. `devicePixelRatio`
is not known at authoring time and is not the limiting factor (the artboard
transform is), so the host cannot ask the browser for the scale.

## Rung 4 — public solutions

Searched: how design tools choose a default stroke (Figma's 1 px at file
scale, Illustrator's point stroke, dashboard kits' 1–2 px at 1920).

Found: those defaults assume the design is viewed near 1:1 or the stroke is a
hairline at a known export size. A dashboard theme is shown from 320 px to
1920 px, so a single artboard-unit default cannot serve both. Industry kits
scale their rule weight to the canvas (about 0.4% of the long edge) rather than
fixing one pixel value.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Default to `max(2, round(artboard.width / 240))` in `add_shape` | Every bare path is about 1.3 px on a 320 px preview and a visible rule at 1920 | The default is tied to width, not the smaller display | Chosen |
| Keep 2 and document the units | No behaviour change | The tool's default remains unusable at the reported viewport; the author must still discover the scale | Rejected |
| Set `strokeUniform` | Keeps stroke relative to the object | Does not know the artboard-to-display scale either | Rejected |
| Ask the caller for a display width | Exact | The MCP authoring step has no display, and a required field for every path is a call burned | Rejected |
| Change `theme-kit`'s `path()` default | One owner | Node-side callers without an artboard would inherit a number chosen for one canvas | Rejected |

## Rung 6 — smallest probe

A 1920 × 1080 theme with one horizontal `Path` was loaded in the real player
at 320 × 180 through the host. With `strokeWidth: 2` and a red stroke the line
is a faint hairline over the backdrop; with `strokeWidth: 20` it is plainly
visible, and the reviver reports no issue in either case. So the object paints
and the default, not the primitive, is at fault.

## Decision

`add_shape` supplies `strokeWidth` when the caller omits it:
`Math.max(2, Math.round(artboard.width / 240))`. An explicit `strokeWidth`,
including 2, is passed through unchanged. The tool description states that
points and width are artboard units, and that points are relative to the box's
top-left.
