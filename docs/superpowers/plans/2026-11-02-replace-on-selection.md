# Replace on the selection — plan

- **Date:** 2026-11-02
- **Spec:** `docs/superpowers/specs/2026-11-02-replace-on-selection-design.md`
- **Issue:** #66

## Task 1 — Keep the declaration surface

- No rail-slot, pane or host change: the Assets pane keeps its slot, title
  count, declared-file list, import/background import, previews, video and font
  editors, removal and its reference refusal.

## Task 2 — Replace on the selection

- `object-actions.ts`: `ObjectTarget` gains `asset?: "image" | "svg"`; add
  `replace-asset` with an `ImageUp` glyph, eligible on an unlocked single
  object with an asset reference, running `session.replaceSelectedAsset()`.
- `bridge.ts`: project `asset` from `objectAssetReference(active)`.
- `session-facade.ts` / `editor-session.ts`: implement
  `replaceSelectedAsset()` — pick a file, declare it through
  `AssetManager.import`, import its pixels with
  `imageManager.importImage({withoutAdding: true, withoutSave: true})`, call
  `FabricImage.setElement(element, {width, height})` to keep the authored box,
  re-point `setObjectAssetReference`, `setCoords`, `requestRenderAll`, then
  `historyManager.saveState()`.
- Tests: registry eligibility (image/svg yes; group, locked, unregistered no),
  bridge projection, and a DOM case proving the swap keeps position/size and
  changes the reference; a refused video is dropped without touching the
  object.

## Task 3 — Verify

- `npm run gate` (capture the exit code from a file, not a pipe).
- Merge to local `main` after green.
