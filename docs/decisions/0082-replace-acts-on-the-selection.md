# 0082 — Replace acts on the selection; declarations keep their pane

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:**
  - `src/web/packages/editor/src/editor-shell/shell-layout.tsx`
  - `src/web/packages/editor/src/editor-shell/bridge.ts`
  - `src/web/packages/editor/src/editor-session.ts`

## Problem

#66 asked to remove the Assets pane on the premise that it duplicates the
layer tree. The shipped pane is not that version: it owns the declarations that
can never become layers (video and font), their previews, metadata, removal and
its reference refusal, plus per-declaration byte replacement. Removing it would
strand those files. What is genuinely missing is a replace that acts on one
placed object rather than on every use of one declaration.

## Rung 1 — internal owner

Searched: CodeGraph and source for `AssetsPane`, `createAssetsPane`,
`AssetManager.replace`, `AssetManager.hydrate`, `objectAssetReference`,
`OBJECT_ACTIONS`, `objectActionsFor`.

Found:

- `panes/assets/assets-pane.tsx` already owns the declaration list, import,
  preview, remove-and-refusal and the video/font editors. It is mounted by
  `createAssetsPane` into one host node and is the only surface for a video or
  font.
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
| Remove the Assets pane | Strands video/font declarations and their reference refusal | Rebuild their management elsewhere | Rejected |
| Rebuild the pane as part of the Add pane | Duplicates a working surface | Large, no capability gained | Rejected |
| Replace bytes under the shared id from the selection | Changes every use of one id | Misleading | Rejected |
| Declare a new file and re-point the selected object | One object changes; prune handles the old id | Picker + reference set | Accepted |
| Re-place a new object and copy its transform | Loses authored box on aspect change | Geometry copy | Rejected |

## Rung 6 — smallest probe

`AssetManager.hydrate` is the executable proof that `setElement` keeps the
object and its transform; the new path differs only by passing the authored
`{ width, height }` and writing the new reference. No separate probe was needed.

## Decision

Keep the Assets pane. Add a selection-scoped replace that declares a new file,
swaps the element with the authored size and re-points the object's
`yunariAsset` reference. The old declaration is pruned by the existing save path
when nothing holds it.
