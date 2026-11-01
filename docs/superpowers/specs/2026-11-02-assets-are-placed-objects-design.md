# Assets are placed objects — design

- **Date:** 2026-11-02
- **Status:** approved by the user's issue ruling (#66); implementation authorised
- **Area:** editor shell, Add pane, selection actions, asset declarations

## Problem

The Assets pane treats a declared file as a document subject with its own pane.
The document does not model it that way: a placed image or SVG is a Fabric
object (its layer is the object), and a video or font never becomes an object at
all. Insert already lives in the Add pane, so the pane's remaining jobs are the
declared-file list and a byte replacement that acts on every use of one id.

Two capabilities must survive the pane:

1. **Declared-file management** — importing local files, seeing every declared
   file, previewing it, removing it (refused while referenced), replacing its
   bytes, and the video/font metadata that only a declaration can carry.
2. **Replace on the selection** — re-point one placed image or SVG at a new
   file, preserving its authored transform.

## Decision

- The declared-file list, its import and the finder link move into the **Add
  pane**, below the insert tiles. The list still comes from the asset manager's
  declarations, so a video or font remains removable and a referenced file
  remains refused. No new pane, rail slot or count is added.
- **Replace file…** joins the object-action registry. It is offered only when
  the active object is a single image or SVG carrying a `yunariAsset`
  reference; it opens the file picker, declares the new file, swaps the object's
  element and re-points the reference. The object's `left`, `top`, `angle`,
  `scaleX`, `scaleY` and authored width/height are unchanged, so the new file
  fills the same box.
- The old declaration is left to the save-time prune. If another object, the
  artboard background or a type preset still holds it, it stays; if nothing
  does, it is removed with the rest of the unused files.
- The `assets` rail slot, its `Pane`, its host wiring and its copy are removed.
  `data-yunari-panel-host-assets` is kept as the file section's host inside the
  Add pane, so the session keeps one mount point and the imperative asset tree
  is unchanged.

## Non-goals

- Changing the asset manager, the envelope or the save-time prune.
- A second insertion surface; insert stays in Add.
- Moving the video/font editors out of the file section.
- Changing the asset finder modal.

## Behaviour

- Opening Add shows the insert tiles and, below them, the declared files with
  the existing import, background-import and find controls.
- With one placed image selected, the dock and the canvas context menu offer
  **Replace file…**. Picking a supported image or SVG swaps that object only.
- The action is absent for groups, ActiveSelections, text, charts, shapes and
  images with no declaration, and disabled while the object is locked.
- A refused file reports through the existing import message path and leaves the
  object untouched; a successful swap is one undo step.
