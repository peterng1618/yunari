# Assets are placed objects — plan

- **Date:** 2026-11-02
- **Spec:** `docs/superpowers/specs/2026-11-02-assets-are-placed-objects-design.md`
- **Issue:** #66

## Task 1 — Move the file list into the Add pane

- `shell-layout.tsx`: drop the Assets `Pane`; render the existing
  `hosts.assets` node under the Add pane's host, under a **Files** heading.
- `rail.tsx`: remove `assets` from `RailSlot` and `RAIL_SLOTS`.
- `ui-copy.ts`: remove `rail.slots.assets`; keep `paneCounts.files` for the
  file section heading count.
- Update `rail.dom.test.tsx`, `shell-layout.dom.test.tsx`,
  `accessible-names.dom.test.ts`, and the e2e helpers/specs that opened the
  Assets slot (they now open Add; `assetCard` scopes to the Add pane).

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
- Tests: registry eligibility (image/svg yes; group, locked, unregistered no)
  and a DOM case proving the swap keeps position/size and changes the
  reference.

## Task 3 — Verify

- `npm run gate` (capture the exit code from a file, not a pipe).
- Merge to local `main` after green.
