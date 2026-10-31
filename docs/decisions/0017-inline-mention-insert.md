# 0017 — inline `@` insert writes a value run

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/editor-session.ts`,
  `src/web/packages/editor/src/text-manager/index.ts`,
  `src/web/packages/editor/src/selection-inspector/run-edits.ts`,
  `src/web/packages/editor/src/editor-interaction.ts`,
  `src/web/packages/editor/src/editor-shell/editor-shell.css`

## Problem

Typing `@` in Fabric's inline text edit inserts a literal character. A reading
must be a value run (`kind: "value"` + `bindingId`), because only that shape
formats, carries a unit and reports a missing source. The interaction also has
to filter while the author types, accept on Tab, keep Space a space, and put a
list at a caret Fabric owns — a wrong split would silently drop the runs the
object already holds.

## Rung 1 — internal owner

`codegraph explore` and source reads around `createTextManager`,
`keepTypedText`, `writeRunSource`, `insertReading`'s neighbours in
`run-edits.ts`, `authoredOf`, `EditorSession`'s run ports and `showAuthoringView`
show one owner per half: `text-manager` owns Fabric's edit and its refusal rule,
`run-edits` owns run+binding writes, and `editor-session` is the only holder of
the document's binding store. `keepTypedText` already refuses a typed edit of
more than one run because Fabric hands back one flat string, and `run-edits` had
per-run writes but no insertion. The missing piece is a split at a caret, plus a
port from the manager to the session's bindings.

## Rung 2 — installed dependencies

Fabric 7.4.0 (`node_modules/fabric/src/shapes/IText/`) donates the editing
session: `hiddenTextarea` with `selectionStart`/`selectionEnd`,
`updateFromTextArea` syncing `text` and caret, `updateTextareaPosition` placing
the textarea at the caret on every selection change, and the event order
`text:editing:exited` before `object:modified` (`ITextBehavior.exitEditing`). It
does not donate a run model, a caret rectangle for a popup beyond the textarea
it places, or a way to say which run each typed character came from. Those are
Yunari's own in `run-edits` and `text-manager`.

## Rung 3 — native platform

The browser supplies `InputEvent.data` (a typed `@`, null for paste) so the list
opens only on a keystroke, `KeyboardEvent` capture on the textarea so Tab,
Escape and the arrows are decided before Fabric's own listener, and a DOM
`listbox`/`option` pair for the list. No native widget offers a caret-anchored
popup over a canvas.

## Rung 4 — public solutions

Searched: CodeMirror's autocompletion example; `prosemirror-autocomplete`
options and reducer; `prosemirror-suggestions`; the ProseMirror forum's mention
architecture thread. Found: all keep a trigger locked at the `@`, filter on
further typing, move with up/down, accept on Enter/Tab, and close on Escape or
the first Space (`cancelOnFirstSpace` defaults true); the accepted selection is
inserted as a structured node whose id the surrounding document owns. They rely
on a document model with positions; Fabric's IText is a flat string, so the
split remains Yunari's own write.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Split the one literal run at the typed range and add a value run + binding | Reuses `run-edits` and the document's binding writer; one new rule | The edit must end for the runs to paint | Chosen |
| Type the reading's text and bind the whole run afterwards | No popup | Loses surrounding prose, and a multi-run text has no mapping | Rejected |
| Keep editing with a token painted mid-session | Author could continue typing | Fabric's hidden textarea still holds the flat string, so further keystrokes edit text the token no longer represents | Rejected |
| Decode Fabric's `styles` per character into runs | Could edit multi-run text inline | Fabric records styles, not run identity; binding boundaries are not recoverable | Rejected |

## Rung 6 — smallest probe

`text-manager/index.dom.test.ts` drives a real Fabric `IText` in jsdom: a typed
`@` opens the list, `@gp` filters to one row, Tab calls the port with
`{start, end, semanticKey}` and ends the edit, Space and Escape close it, and a
two-run text never opens it. `run-edits.test.ts` proves the split, the binding
and the refusals. The caret anchor reads the textarea's own inline
`left`/`top`/`padding-top`, which Fabric updates on every input, so no private
method is called.

## Decision

Build the insert as a `TextMentionPort` from `text-manager` to the session:
`insertReading` in `run-edits` replaces the typed range inside one literal run
with a value run that copies that run's look, and the session writes the new
binding through `EditorDocument.setBindings`. The list is editor chrome styled
as the menu popup's choice rows. A saved key whose source disappears keeps the
run and binding, so the run editor's existing undeclared/unmapped note and
placeholder are the rule — no second missing-source path is added.
