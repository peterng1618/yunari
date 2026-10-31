# 0032 — Artboard paint's pure forms move to renderer-core

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/artboard-paint.ts`, `src/web/packages/renderer-core/src/theme/artboard-paint.test.ts`, `src/web/packages/renderer-core/src/index.ts`, `src/web/packages/scene-fabric/src/artboard-paint.ts`, `src/web/packages/scene-fabric/src/artboard-paint.test.ts`, `src/web/packages/scene-fabric/src/index.ts`, `src/web/packages/editor/src/asset-finder/finder-card.tsx`, `src/web/packages/editor/src/editor-shell.ts`, `src/web/packages/host/src/themes/store.ts`

## Problem

The host's theme store imports `cssArtboardPaint` from `scene-fabric`, the
Fabric-backed layer, to produce one CSS string (#177). It is tree-shaken today,
but the dependency runs the wrong way: `renderer-core` is the Fabric/DOM-free
shared layer, and `AGENTS.md` keeps Fabric in `scene-fabric`. A host-side store
must not reach through the renderer layer for a pure format conversion.

## Rung 1 — internal owner

Searched with CodeGraph/source: `scene-fabric/src/artboard-paint.ts` (all five
exports), every consumer (`host/src/themes/store.ts`, `editor/src/editor-shell.ts`,
`editor/src/asset-finder/finder-card.tsx`, `scene-fabric/src/scene.ts`), the
renderer-core barrel, and the colour-mode precedent named by #177.

Found: the module holds one Fabric form (`fabricArtboardPaint`), one canvas form
(`fillArtboardPaint`), one CSS form (`cssArtboardPaint`), a content key and
three pure predicates. The CSS form and predicates never touch Fabric or the
DOM. The colour mode already lives in `renderer-core`, which is the precedent
for this move.

## Rung 2 — installed dependencies

Read: `fabric/es`'s `Gradient` (only `fabricArtboardPaint` constructs one) and
`culori`'s role in the colour mode.

Found: `cssArtboardPaint` needs neither. `gradientLine` is arithmetic over the
stored angle and a box; the Fabric form and the canvas form both use it. Moving
the arithmetic and the predicates leaves `Gradient` exactly where it belongs.

## Rung 3 — native platform

Searched: CSS gradient syntax and the Canvas 2D `fillStyle` rules.

Found: the CSS form is a string and the canvas form a `fillStyle` assignment;
neither needs a platform API beyond what the module already uses. The platform
does not decide where the string is produced.

## Rung 4 — public solutions

Searched: the repository's existing shared-layer boundary and #177's own
evidence; no library or upstream implementation is involved.

Found: the comparable choice is stated in `renderer-core/package.json`'s own
note — the package must stay Fabric-free because the host imports its runtime
values in Node. A pure paint-to-CSS conversion satisfies that constraint.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Move the pure forms to `renderer-core`; leave Fabric forms in `scene-fabric` | restores the dependency direction; one owner for the paint vocabulary | update five import sites and split the test file | chosen |
| Re-export from `scene-fabric` for existing callers | keeps the wrong direction visible | a wrapper with no owner value; `AGENTS.md` forbids it after a move | rejected |
| Duplicate the CSS conversion in the host | smallest immediate diff | two copies of the angle rule and the predicates | rejected |

## Rung 6 — smallest probe

The existing `artboard-paint.test.ts` cases are the probe: Fabric conversion and
paint-key cases stay in `scene-fabric`, and the CSS cases move to
`renderer-core`'s own suite. Both suites run without a browser. A host build
with the new import is the second reading; `npm run build` and the full gate
prove no Fabric enters `dist/main.js`.

## Rung 7 — decision

`artboardSolidColor`, `isArtboardGradient`, `artboardGradientLine` and
`cssArtboardPaint` live in `renderer-core/src/theme/artboard-paint.ts` and are
exported from its barrel. `scene-fabric` imports them and keeps only
`fabricArtboardPaint`, `fillArtboardPaint`, `artboardPaintKey` and
`sceneBoxesOf`-adjacent Fabric work; its barrel no longer exports the CSS form.
The editor and the host import `cssArtboardPaint` from `@yunari/renderer-core`.

No compatibility re-export is kept: the workspace is pre-release and every
caller moves in this change.
