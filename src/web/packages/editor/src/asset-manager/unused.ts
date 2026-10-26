import type { FabricObject } from "fabric/es";
import { assetReferencedBy, type LocalAssetReference } from "./index.js";

/**
 * The declarations nothing keeps alive: no envelope reference and no object in
 * the scene. A credit is attribution, not a reference — it never keeps an asset
 * alive and follows the asset it names, so it is not an input here.
 */
export function unusedAssets(input: {
  readonly declarations: readonly LocalAssetReference[];
  readonly objects: readonly FabricObject[];
  readonly holdsAsset: (assetId: string) => boolean;
}): readonly LocalAssetReference[] {
  return input.declarations.filter(
    (asset) =>
      !input.holdsAsset(asset.id) &&
      !assetReferencedBy(input.objects, asset.id),
  );
}
