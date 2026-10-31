# 0040 — A held gesture's preview is settled as one edit

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/selection-inspector/index.ts`, `src/web/packages/editor/src/selection-inspector/pending-preview.ts`

## Problem

A slider preview writes the document and records no history; the release
commits, Escape cancels. A gesture that ends neither way — the selection moves
while the press is held, or the column is republished for another reason —
leaves a value in the document that no history entry covers. The author then
holds an uncommitted value they cannot undo in one step. The preview state must
be owned by the same funnel that writes it and records history.

## Rung 1 — internal owner

Searched: CodeGraph for `SelectionEdits`, `preview`, `cancelPreview`, `commit`
and `historyManager.saveState`.
Found: `selection-inspector/index.ts` owns the write funnel (`applyField`,
`edits.preview`, `edits.cancelPreview`, `edits.commit`) and is the only caller
of `saveState` for a field edit. `render()` runs on every selection/scene
republish and already owns the described target. `ControlSlider` owns the
gesture's transient flags but its commit callback is revision-guarded, so a
commit arriving after the selection moved is refused — the funnel's captured
target is the part that survives.

## Rung 2 — installed dependencies

Searched: `EditorHistory.saveState`, fingerprint dedupe; Fabric selection
events.
Found: `saveState` is fingerprint-deduplicated, so saving a document whose
value did not change records nothing. That is the dedupe the ruling relies on.

## Rung 3 — native platform

Searched: none applicable — the gesture and its history are product state, not a
platform capability.

## Rung 4 — public solutions

Searched: undo/redo best practices for live-preview editors (continuous
gestures, drag-settle).
Found: the standard shape is one history entry per gesture, settled at the
gesture's end; no library donates it to this funnel.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Slider unmount effect commits its last preview | Gesture control owns it | Commit closure is revision-stamped and refused after the move; panel-close paths differ | Rejected |
| Cancel on selection change | Ends without the edit | Contradicts the ruling and loses the value | Rejected |
| Funnel remembers the preview and settles on republish | Same owner as the write and the history | None | Chosen |

## Rung 6 — smallest probe

`pending-preview.test.ts` drives the state machine: settle once, discard a
cancelled field, report another field's ended gesture, and clear without a save
on restore. The funnel's use of it is covered by the existing selection-moved
and slider commit suites.

## Decision

The funnel records the object and value a preview wrote. A republish, a
different field's preview/commit, or a cancel settles the pending gesture:
the document is saved once, and the history's fingerprint dedupe records nothing
when the preview changed nothing. A history restore clears it instead, because
the restored document is not the one the preview described.
