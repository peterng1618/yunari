# 0086 — Custom shapes are Fabric Paths, not new classes

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/sector-object.ts`, `src/web/packages/scene-fabric/src/index.ts`, `src/web/packages/scene-fabric/src/glass.ts`, `src/web/packages/scene-fabric/src/object-paint.ts`, `src/web/packages/renderer-core/src/theme/glass.ts`, `src/web/packages/editor/src/new-object-defaults.ts`, `src/web/packages/editor/src/new-object-panel.ts`, `src/web/packages/editor/src/path-presets.ts`, `src/web/packages/editor/src/panes/add/path-glyph.tsx`, `src/web/packages/editor/src/object-actions.ts`, `src/web/packages/editor/src/editor-session-actions.ts`, `src/web/packages/editor/src/editor-shell/session-facade.ts`, `src/web/packages/editor/src/editor-shell/bridge.ts`, `src/web/packages/editor/src/editor-shell/canvas-context-menu.tsx`, `src/web/packages/editor/src/editor-shell/shell-layout.tsx`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/editor-shell/layer-tree.ts`, `src/web/packages/editor/src/panes/add/add-pane.tsx`, `src/web/packages/editor/src/panes/composition/kind-mark.tsx`, `src/web/packages/editor/src/settings-mode/pages/appearance-page.tsx`, `src/web/packages/editor/src/selection-inspector/panel.ts`, `src/web/packages/editor/src/selection-inspector/view.ts`, `src/web/packages/editor/src/controls-manager/index.ts`, `src/web/packages/editor/src/ui-copy.ts`

## Problem

The Add pane offers eight shape kinds, three of which are not basic Fabric
geometries: `line` is a Fabric `Line`, `arc` and `wedge` are Yunari classes that
extend `Circle`, and `polyline` is a second way to spell an open figure that a
`Path` can already draw. The user asked for two shape sections — Basic (Fabric
geometries) and Custom (Path presets) — with Horizontal line, Arc and Wedge as
the first presets. A wrong choice here either keeps a second geometry model
beside `Path`, or loses a custom figure on reopen.

## Rung 1 — internal owner

Searched: `SHAPE_KINDS`, `createNewShape`, `insertGroups`, `CONSTRUCTION_ACTIONS`,
`insertNewShape`, `shapeKindOf`, `createShapeFields`, `createLineControls`,
`supportsPanelFields`, `refusesFill`, `localPath`, `Arc`, `Wedge`, `Polyline`.

Found: `new-object-defaults.ts` owns construction and `SHAPE_KINDS`; the Add
pane and context menu both render `insertGroups()`; the inspector owns
per-class geometry editors for Polyline points, Line endpoints and sweep angles;
`scene-fabric` owns the two custom classes and their glass/paint branches.
Fabric owns `Path`, `Polyline`, `Line` and `Circle`. Nothing needs a class of
its own to express a line, an arc or a sector.

## Rung 2 — installed dependencies

Searched: Fabric 7 `Path` source/types, `Polyline`, `Line`, `util.makePathSimpler`,
`classRegistry`, `serialize`/`loadFromJSON`; and Context7's Fabric API pages for
`Path` and `Path.makePathSimpler`.

Found: `Path` takes SVG path data (string or parsed commands), converts relative
commands and `A` arcs to absolute/cubic form through `makePathSimpler`, measures
its own bounds, and serialises through the normal Fabric pipeline. `Polyline`
stores points and `Line` stores four endpoints; both are specialisations whose
geometry is a subset of a path's `M`/`L`/`Z` commands. Neither offers editing
that `Path`'s own data field cannot express. `insertNewShape` already constructs
a `Path` from data and the inspector already edits that data.

## Rung 3 — native platform

Searched: SVG path grammar for `M`, `L`, `H`, `A` and `Z`; Canvas path drawing.

Found: the platform has one path grammar. Fabric's parser is the only consumer
here, and it already handles arcs. No platform API is needed beyond that parser.

## Rung 4 — public solutions

Searched: Context7 Fabric docs for `Path` construction, `SerializedPathProps`,
`makePathSimpler`; the installed Fabric `Path`/`Polyline` sources; Fabric's own
Shape documentation.

Found: Fabric's public answer is Path for arbitrary SVG figures and the simpler
classes as conveniences. Arc data survives authoring but is normalised to cubic
commands on parse, so a stored preset may not keep the literal `A` token. That
is Fabric's own representation and needs no second parser here.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep `Arc`, `Wedge`, `Line`, `Polyline` kinds | Preserves per-class editors and glass on a wedge | Keeps four construction paths, three glyphs and two glass/paint branches for figures a Path already draws | Reject |
| Convert only the Add-pane presets to `Path`, keep the classes for old scenes | Old scenes reopen | Leaves dead classes and two scene models; the user asked for removal | Reject |
| Make all custom shapes `Path` data; Basic keeps Fabric's rect/ellipse/polygon/path | One persisted shape model, one inspector field, no new geometry | Old `Arc`/`Wedge` objects cannot revive; Polyline's points editor goes | Accept |

## Rung 6 — smallest probe

Already established in the product: `NEW_PATH` constructs a `Path` from SVG
data and `pathDataOf`/`parsedPath` round-trip its commands. The remainder is a
data string per preset and Fabric's own measurement, so no new probe was needed.

## Decision

Reuse Fabric `Path` for every custom shape. `SHAPE_KINDS` becomes the Basic
section (`rect`, `ellipse`, `polygon`, `path`). A `PATH_PRESETS` registry owns
the Custom section (`line` → Horizontal line, `arc`, `wedge`) and each preset is
constructed as a `Path` with authored data. Remove the `Arc`/`Wedge` classes,
their glass/paint branches, the Line endpoint controls and the Polyline/Line
geometry fields. Persisted themes carrying a removed type are refused by the
existing envelope rules rather than translated; the product is pre-release and
this note records the break. New presets are added as data, never as classes.

Glass follows the geometry rather than the class. `Path` joins the published
glass vocabulary, and `hasClosedPath` in `scene-fabric` decides whether a path's
own commands close every subpath; the renderer clips to those commands and the
editor offers the control only when the same predicate says yes. An open path
is refused, not clipped to its bounding box — the box is a rectangle the author
did not draw. The blur radius is authored in artboard units, so the same value
diffuses a different number of device pixels across differently sized shapes;
that is the accepted reading of one blur setting, not a per-shape strength.

The author can add and remove custom presets in Settings. `path-presets.ts` owns
the stored list and the live revision, `appearance-page.tsx` edits it, and the
Add pane subscribes so the tiles change without a reload. A user preset is a
label plus SVG path data; `userPathPresetFrom` parses it with Fabric and decides
fill versus stroke from `hasClosedPath`. Its tile draws the preset's own path
through `path-glyph.tsx` rather than assigning it a Lucide approximation — the
drawing is the mark, so a shape the author authored cannot be mislabelled by a
stand-in glyph.
