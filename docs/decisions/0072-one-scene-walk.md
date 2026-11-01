# 0072 — One at-any-depth scene walk

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/scene-objects.ts`,
  `src/web/packages/scene-fabric/src/adapter.ts`,
  `src/web/packages/scene-fabric/src/glass.ts`,
  `src/web/packages/scene-fabric/src/index.ts`,
  `src/web/packages/editor/src/asset-manager/index.ts`

## Problem
Nine modules each spell the same Fabric traversal: iterate a list, visit the
object, then recurse through `Group.getObjects()`. A single missing recursion
fails quietly — an authored object inside a card is reported unused, a binding
keyed by a grouped object reads as dangling, or a glass panel stops tracking a
group it just joined. The walk must have one owner that every "what does the
scene hold" question spends, while each caller keeps its own question.

## Rung 1 — internal owner
Searched: `sceneObjects`, `instanceof Group`, `getObjects()` across
`src/web/packages`; read `asset-manager/index.ts`, `adapter.ts`, `glass.ts`,
`palette-references.ts`, `object-type.ts`, `fabric-text.ts`, `card-library.ts`,
`clipboard-manager/index.ts`, `chart-manager/index.ts`.
Found: `sceneObjects` lived in `packages/editor/src/asset-manager/index.ts`,
which is an editor module. `@yunari/scene-fabric` is the lower package
(`editor` depends on `scene-fabric`), so the six scene-fabric callers cannot
import it there. Ownership moves to `scene-fabric`, and the editor consumers
import the same function. That is one owner, not a second module.

## Rung 2 — installed dependencies
Searched: `fabric` 7.4.0 entry points `fabric/es`, source and type definitions
for `Canvas.getObjects`, `Group.getObjects`, `forEachObject`.
Found: Fabric exposes only direct children. `Canvas.getObjects()` is the root
collection; `Group.getObjects()` is that group's own children; `forEachObject`
is documented as the group's direct members. No recursive traversal is donated,
so the walk has to be owned locally.

## Rung 3 — native platform
Searched: browser and Node APIs available to `scene-fabric`.
Found: nothing at the platform layer knows a Fabric object tree. The native
collection iterator (`for...of` over `getObjects()`) is used, but recursion over
nested groups is application structure.

## Rung 4 — public solutions
Searched: "Fabric.js traverse all objects recursively group getObjects helper";
Fabric community examples and v5/v6 traversal snippets.
Found: the common snippet is the same four-line recurse-over-`getObjects`
callback walk with no early-exit support; no library ships it as an API. The
snippet matches what the callers already spell, so adoption is a move, not new
mechanism. Predicate/find variants are their own shape and are not needed here.

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep nine local recursions | No | every new depth rule re-spells the walk | reject |
| Helper in `editor/asset-manager` | No | scene-fabric cannot import editor without inverting the dependency | reject |
| Shared callback walk in `scene-fabric` | Yes | callers with early exit keep their own finder | accept |

## Rung 6 — smallest probe
The existing grouped cases in `adapter.dom.test.ts`,
`palette-references.dom.test.ts`, `object-type.dom.test.ts`,
`glass.dom.test.ts` and `fabric-text.dom.test.ts` are the probe: they assert a
grouped object is seen, and they fail if the shared walk stops at the root.
Migrated callers run unchanged against them.

## Decision
Export `visitSceneObjects(objects, visit)` and its array form `sceneObjects`
from `packages/scene-fabric/src/scene-objects.ts`. It is a pure pre-order walk:
groups are visited as well as leaves, roots first, siblings in authored order.
Each caller keeps its question in the callback. Callers needing early exit keep
their local finder. Local recursions are deleted, not wrapped.
