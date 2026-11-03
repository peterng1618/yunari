# 0099 — The agent restacks a scene object by its authored array order

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/theme-kit/src/document.ts`,
  `src/web/packages/mcp/src/tools/compose.ts`,
  `src/web/packages/mcp/src/tools/compose-tools.ts`

## Problem

The MCP compose tools append every object, so a scrim added after a text block
paints over it. The editor has layer controls; the agent surface had no way to
put an object behind an existing one short of removing and re-adding the scene.
The wrong choice here fails quietly: a second ordering model (a z-index, a
separate layer list) would persist state the renderer does not read and the two
orders could disagree.

## Rung 1 — internal owner

Searched: `addSceneObject`, `updateSceneObject`, `removeSceneObject`,
`listSceneObjects`, `createLayerManager`, `visitSceneObjects`, `sceneOf`,
`arrange`, `layer-tree`.

Found: the scene's `objects` array is the paint order, and
`theme-kit/src/document.ts` is the owner of every scene mutation over the
envelope. The editor's `layer-manager` moves Fabric objects in the mounted
canvas and saves; it is browser state and cannot be imported by the host-side
MCP server. No envelope-level restack helper existed.

## Rung 2 — installed dependencies

Searched: `scene-fabric/src/persist.ts`, `scene-fabric/src/scene-objects.ts`,
Fabric's `Group.toObject` and array order.

Found: Fabric revives and serializes objects in array order, so the authored
array is already the whole stacking model. `Group` keeps children in its own
array, which is why the editor's layer manager resolves the holder first.
`scene-fabric`'s `visitSceneObjects` confirms nested objects belong to their
group's order, not the root's.

## Rung 3 — native platform

Searched: none needed. Array order is the platform here; there is no
browser/Node API involved.

## Rung 4 — public solutions

Searched: the editor's own four operations (`bringToFront`, `bringForward`,
`sendToBack`, `sendBackwards`) and the MCP compose/tool conventions.

Found: the four moves are the established vocabulary, with an explicit
"already there" answer rather than an error. A z-index property is not part of
Fabric's serialized form and would need a new renderer rule.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Add a persisted z-index property | A second order model | Renderer, validator, migration, editor projection | Rejected |
| Move Fabric objects in the MCP server | Wrong process: no canvas | A headless canvas to revive into | Rejected |
| Reorder the envelope's sibling array in `theme-kit` | The persisted truth, already read by Fabric | A nested walk | Accepted |
| Remove and re-add objects from the tool | Changes ids and bindings | Data loss on every restack | Rejected |

## Rung 6 — smallest probe

`document.test.ts` moves a root object to the front and back, asserts a
same-end move answers `moved: false` without changing order, moves a grouped
child inside its group while the root order stays, and refuses an unknown id.
`tools.reorder.test.ts` adds a text and a scrim, sends the scrim back, and
asserts the listed order and `validate_theme` both agree. The full gate passed:
exit 0.

## Decision

Add `moveSceneObject(envelope, id, move)` to the theme-kit document owner. It
walks the object tree, finds the id in its own sibling list, and moves it among
those siblings only, returning a cloned envelope and `moved`. The MCP
`reorder_object` tool exposes `front`, `forward`, `backward` and `back`, and
writes the draft. Grouped objects move within their group, matching the editor's
holder rule, so no object silently leaves its group.

Skipped: a z-index or separate layer list. Add neither unless the persisted
scene format itself changes; the array order is already the renderer's contract.
