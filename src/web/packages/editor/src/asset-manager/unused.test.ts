import { setObjectAssetReference } from "@yunari/scene-fabric";
import { type FabricObject, Rect } from "fabric/es";
import { describe, expect, it } from "vitest";
import type { LocalAssetReference } from "./index.js";
import { unusedAssets } from "./unused.js";

function imageAsset(id: string): LocalAssetReference {
  return { id, kind: "image", path: `assets/${id}.png`, sha256: "0" };
}

function fontAsset(id: string): LocalAssetReference {
  return {
    id,
    kind: "font",
    path: `assets/${id}.woff2`,
    sha256: "0",
    family: "Inter",
    weight: 400,
    style: "normal",
    format: "woff2",
  };
}

function placedObject(assetId: string): FabricObject {
  const object = new Rect();
  setObjectAssetReference(object, { assetId, kind: "image" });
  return object;
}

describe("unusedAssets", () => {
  it("keeps an asset used by a placed object", () => {
    const photo = imageAsset("photo");

    expect(
      unusedAssets({
        declarations: [photo],
        objects: [placedObject("photo")],
        holdsAsset: () => false,
      }),
    ).toEqual([]);
  });

  it("keeps a font used by a preset face", () => {
    const face = fontAsset("inter-400");

    expect(
      unusedAssets({
        declarations: [face],
        objects: [],
        holdsAsset: (assetId) => assetId === "inter-400",
      }),
    ).toEqual([]);
  });

  it("finds an imported font nothing references", () => {
    const photo = imageAsset("photo");
    const imported = fontAsset("local-face");

    expect(
      unusedAssets({
        declarations: [photo, imported],
        objects: [placedObject("photo")],
        holdsAsset: () => false,
      }),
    ).toEqual([imported]);
  });
});
