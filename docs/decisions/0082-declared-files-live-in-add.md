# 0082 — Declared files live in Add; replace acts on the selection

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:**
  - `src/web/packages/editor/src/editor-shell/shell-layout.tsx`
  - `src/web/packages/editor/src/editor-shell/bridge.ts`
  - `src/web/packages/editor/src/editor-session.ts`

## Problem

Removing the Assets pane must not lose declared-file management or the only
route that changes a placed object's picture. A wrong seam here fails quietly:
a video or font with no list becomes un-removable, a replace that re-places the
object loses its authored transform, and a replace that swaps bytes under the
shared id changes every other use of it without saying so.

## Rung 1 — internal owner

Searched: CodeGraph and source for `AssetsPane`, `createAssetsPane`,
`AssetManager.replace`, `AssetManager.hydrate`, `objectAssetReference`,
`OBJECT_ACTIONS`, `objectActionsFor`, `PaneRequestStore`.

Found:

- `panes/assets/assets-pane.tsx` already owns the declaration list, import,
  preview, remove-and-refusal and the video/font editors. It is mounted by
  `createAssetsPane` into one host node, so the host can move without rewriting
  the list.
- `AssetManager.import(file)` declares bytes and returns the reference;
  `AssetManager.hydrate(canvas)` is the existing proof that replacing pixels is
  `FabricImage.setElement(element)` — the object keeps its transform.
- `setObjectAssetReference` / `objectAssetReference` in
  `scene-fabric/object-asset.ts` are the one owner of the object↔declaration
  link; the save-time prune already asks `assetReferencedBy` and the document's
  own predicate.
- `OBJECT_ACTIONS` is the one registry behind the dock, the canvas context menu
  and the layer footer; `ObjectTarget` is its Fabric-free projection.

Unsolved: an eligibility bit for "has an asset reference", and a session method
that declares a picked file without re-placing the object.

## Rung 2 — installed dependencies

Searched: Fabric's `FabricImage.setElement` and `_setWidthHeight` in
`node_modules/fabric/dist/index.mjs`; the editor's `ImageManager.importImage`
options.

Found: `setElement(element, { width, height })` replaces the pixels and keeps
the authored box; `importImage({ withoutAdding: true, withoutSave: true })`
decodes without adding or saving. No other dependency owns declarations or the
reference link.

## Rung 3 — native platform

Searched: `HTMLInputElement` file picking, `URL.createObjectURL`.

Found: a hidden file input is the platform's picker; the manager already revokes
its object URLs. The platform offers no declaration model.

## Rung 4 — public solutions

Searched: Fabric image-replacement discussions and the general
"swap image, keep transform" pattern. Every candidate is the same
`setElement` call this repository already uses in `AssetManager.hydrate`; none
carries a declaration model or the reference walk.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the Assets pane | Contradicts the ruling | None | Rejected |
| Move the list into the Add pane host | Reuses the whole component and manager | Tests and copy only | Accepted |
| Rebuild the list in the asset finder | Duplicates import/remove/metadata | Large | Rejected |
| Replace bytes under the shared id from the selection | Changes every use of one id | Misleading | Rejected |
| Declare a new file and re-point the selected object | One object changes; prune handles the old id | Picker + reference set | Accepted |
| Re-place a new object and copy its transform | Loses authored box on aspect change | Geometry copy | Rejected |

## Rung 6 — smallest probe

`AssetManager.hydrate` is the executable proof that `setElement` keeps the
object and its transform; the new path differs only by passing the authored
`{ width, height }` and writing the new reference. No separate probe was needed.

## Decision

Move the existing file section into the Add pane and add a selection-scoped
replace that declares a new file, swaps the element with the authored size and
re-points the object's `yunariAsset` reference. The old declaration is pruned by
the existing save path when nothing holds it.
