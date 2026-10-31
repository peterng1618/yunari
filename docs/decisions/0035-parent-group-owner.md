# 0035 — One owner for "the group that holds this object"

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/object-holder.ts`, `src/web/packages/editor/src/editor-shell/bridge.ts`, `src/web/packages/editor/src/grouping-manager/index.ts`

## Problem

`object.parent instanceof Group` is the Fabric fact "which group owns this
object". `scene-fabric/src/object-holder.ts` owns it for moves and removals
(`holderOf`), but two editor readers spell the test again because they want
`Group | undefined` rather than a canvas fallback: the grouping manager's
`ownerGroup` (used by `enterGroup`) and the bridge's nested-group entry. A change
to how Fabric holds an object has to be found in all three, and nothing says
which spelling is authoritative.

## Rung 1 — internal owner

Searched: `scene-fabric/src/object-holder.ts` (`holderOf`, `targetsOf` and its
docblock on `parent` versus `group`), `grouping-manager/index.ts` (`ownerGroup`,
`enterGroup`), `editor-shell/bridge.ts` (`enterGroup`), `editor-shell/layer-tree.ts`
(`ownerOf`), and the `vg-410` record (#93).

Found: `holderOf` is the owner of the test and already documents the Fabric trap
(`parent` is the owner, `group` repoints at a live `ActiveSelection`). The two
editor sites need the narrower answer, which `holderOf` cannot give without a
canvas. `layer-tree.ownerOf` is a different question — it reads the projection
tree by id, deliberately, with no Fabric object in hand — and stays as it is.

## Rung 2 — installed dependencies

Searched: Fabric 7.4 `FabricObject.parent`, `Group.getObjects`, and the
`ActiveSelection` reparenting behaviour documented in `object-holder.ts`.

Found: one test answers both callers; the difference is only the fallback. No
lifecycle or ownership behaviour is added by a second entry point.

## Rung 3 — native platform

Not applicable: a pure accessor over Fabric's object graph.

## Rung 4 — public solutions

Searched: the repository's own precedent — `vg-248`'s ruling that `scene-fabric`
owns "which collection holds this object", and the `object-holder.ts` docblock.
The issue itself records that widening `holderOf` was rejected because
`grouping-manager` has no canvas in scope.

Found: the fitting shape is a second entry point on the same owner, not a second
owner. No external library question arises.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Add `parentGroupOf(object): Group \| undefined` to `object-holder.ts`; `holderOf` uses it | one owner, no canvas in the narrow callers | update two call sites | chosen |
| Widen `holderOf` with an optional canvas | one function | every narrow caller computes a holder then narrows it back with `instanceof Group` — the shape `vg-248` deleted | rejected |
| Leave both spellings and document the duplication | smallest diff | the fact still has three authorities | rejected |
| Fold `layer-tree.ownerOf` in as well | fewer spellings | it answers from the projection tree by id; folding it would change its source of truth | rejected |

## Rung 6 — smallest probe

The existing grouping-manager and bridge DOM suites exercise both call sites:
`enterGroup` from a child selects the group (grouping `group-entry` case), and
the bridge picks a nested group's first child (`bridge.dom.test.ts`, "enters a
nested group through one of its children"). Both must stay green with the
spelling removed; the new export is exercised through them rather than a
standalone unit case.

## Decision

Add `parentGroupOf` beside `holderOf`, express `holderOf` through it, and use it
in the grouping manager and the bridge. `layer-tree.ownerOf` keeps its own tree
answer; the new docblock names the two questions apart.
