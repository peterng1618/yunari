# Replace on the selection — design

- **Date:** 2026-11-02
- **Status:** approved by the user's correction to #66; implementation authorised
- **Area:** selection actions, asset declarations, editor shell

## Problem

#66's premise — that the Assets pane duplicates the layer tree — was logged
against an earlier version of that pane. The shipped pane is the only surface
for the files that cannot become layers at all: a video or font is declared,
previewed, annotated and removed there, and removal refuses while anything
still names the file. The layer tree has no asset concept.

What the row still names concretely is missing: re-pointing **one placed
object** at a new file. The pane's replace swaps a declaration's bytes, so
every use of that id changes. A selection-scoped replace is a different
capability, and it does not exist anywhere today.

## Decision

- The Assets pane stays, with its rail slot, title count, declared-file list,
  import/background import, previews, video and font editors, removal and its
  reference refusal.
- **Replace file…** joins the object-action registry. It is offered only when
  the active object is a single unlocked image or SVG carrying a `yunariAsset`
  reference; it opens the file picker, declares the new file, swaps the
  object's element and re-points the reference. The object's `left`, `top`,
  `angle`, `scaleX`, `scaleY` and authored width/height are unchanged, so the
  new file fills the same box.
- The old declaration is left to the save-time prune. If another object, the
  artboard background or a type preset still holds it, it stays; if nothing
  does, it is removed with the rest of the unused files.
- No pane or rail slot changes.

## Non-goals

- Changing the asset manager, the envelope or the save-time prune.
- A second insertion surface; insert stays in Add.
- Moving the video/font editors.
- Changing the asset finder modal.

## Behaviour

- With one placed image selected, the dock, the canvas context menu and the
  layer footer offer **Replace file…**. Picking a supported image or SVG swaps
  that object only.
- The action is absent for groups, ActiveSelections, text, charts, shapes and
  images with no declaration, and disabled while the object is locked.
- A refused file reports through the shell's status line and leaves the object
  untouched; a successful swap is one undo step.
