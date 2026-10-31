# 0034 — The entered group's reachability is view state, and a capture lends it back

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/grouping-manager/index.ts`, `src/web/packages/editor/src/editor-shell.ts`

## Problem

Inside an entered group the manager sets `selectable`/`evented` false on every
object outside it, so the artboard agrees with the layer panel about what is
reachable. Those two keys are also persisted: `SCENE_PERSISTED_PROPERTIES`
carries them so an authored non-selectable background and a locked object
survive an undo (`9067a962`). A history entry or document snapshot taken while
a group is entered therefore records the entry's view state as authored state.
Undo restores it as durable flags with no dim and no context: the canvas answers
only to the group that was entered, and nothing leaves it.

## Rung 1 — internal owner

Searched: `grouping-manager/index.ts` (`applyReachability`,
`restoreReachability`, `leave`, `onHistoryLoaded`, `dimmed`,
`reachabilityTaken`), `editor-shell.ts` (`createNativeEditor`, `snapshot`,
`enterGroupOnDoubleClick`), `history-manager/index.ts` (`serialize` seam),
`scene-fabric/src/persist.ts` (`SCENE_PERSISTED_PROPERTIES`,
`removeGroupEntryFlags`, `serialiseScene`), and the manager's DOM suites.

Found: the grouping manager already owns the transient reachability and already
lends another piece of the same view state — the dim — back for a capture
(`suspendDim`, `vg-527`). The only two seams that produce a scene are
`EditorHistory`'s `serialize` and the shell's `snapshot()`. Both live in
`editor-shell.ts` and can ask the manager.

## Rung 2 — installed dependencies

Searched: Fabric 7.4 `Group.toObject` (`node_modules/fabric/src/shapes/Group.ts`),
`StaticCanvas.loadFromJSON`, `requestRenderAll`, and the repo's
`removeGroupEntryFlags`.

Found: Fabric persists `selectable`/`evented` itself when asked; it strips
nothing. The repo already strips one class of transient group flags
(`subTargetCheck`, `interactive`) at serialisation because they are the entry's
view state. The same owner rule applies to the other two; the difference is that
these are also legitimately authored, so a blanket strip would break authored
locks.

## Rung 3 — native platform

Not applicable: no browser or Node API decides what a captured Fabric scene
carries. `loadFromJSON` is the runtime that restores the flags, and it restores
whatever the document says.

## Rung 4 — public solutions

Searched: Fabric's own `subTargetCheck`/`interactive` handling and the
repository precedent in `persist.ts` (`removeGroupEntryFlags`); no external
library solves "persist the authored values, not the editor's transient ones".

Found: the established pattern in this codebase is suspension around the reader
that outlives the view — `suspendDim` for a capture — and normalisation at the
single scene owner for keys that are never authored. `selectable`/`evented` are
authored as well as transient, so suspension at the capture seam is the fitting
shape.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Manager lends authored flags around each capture (`suspendReachability`) | owner restores its own state; authored locks untouched; mirrors `suspendDim` | two call sites in the shell | chosen |
| Strip `selectable`/`evented` from `SCENE_PERSISTED_PROPERTIES` | smallest diff | regresses authored background/locked objects across undo, the defect `9067a962` fixed | rejected |
| Mark disarmed objects with a transient key and normalise in `serialiseScene` | one seam | scene-fabric learns editor view state and carries a second encoding of the same fact | rejected |
| Stop marking objects unreachable; gate selection elsewhere | no transient keys | the artboard would select what the panel says is out of reach, the rule the entry exists to enforce | rejected |

## Rung 6 — smallest probe

A jsdom probe drove the real `EditorHistory` and grouping manager: enter a
group, edit inside it, save, leave, edit again, save, undo. Before the fix the
restored outsider kept `selectable: false`; a second probe captured
`serialiseScene` while entered and read the same flag in the document. After
the fix both read the authored values. The shell tests repeat the sequences
through `mountEditorShell`, and the snapshot test asserts the only
`selectable: false` node in a saved starter theme is the deliberately locked one.

## Decision

Add `suspendReachability()` to the grouping manager — restore the authored flags,
re-apply the entry on release — and call it around both scene captures in
`editor-shell.ts`: history's `serialize` and the shell's `snapshot()`. The
persisted keys keep their current meaning; the entry stops being able to write
them into a document.
