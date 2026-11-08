// @vitest-environment node

import type { AssetReference, FontAssetReference } from "@yunari/renderer-core";
import { YUNARI_ASSET_PROPERTY } from "@yunari/scene-fabric";
import type { WidgetUnit } from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import { instantiateCard } from "./card-library.js";
import { cardUnitFromWidget, unitAssetDeclarations } from "./widget-unit.js";

/** One packaged unit whose only object draws a declared image. */
function unitWithAsset(assetId: string): WidgetUnit {
  return {
    id: "group-image-card",
    label: "Image",
    document: {
      schemaVersion: "3.0.0",
      fabricVersion: "7.4.0",
      id: "widget",
      scene: {
        version: "7.4.0",
        objects: [
          {
            id: "image",
            type: "image",
            left: 0,
            top: 0,
            [YUNARI_ASSET_PROPERTY]: { assetId, kind: "image" },
          },
        ],
      },
    },
    declarations: [],
    assets: {},
  };
}

/** A unit whose asset reference sits inside a group, not on the root. */
function nestedUnitWithAsset(assetId: string): WidgetUnit {
  return {
    id: "group-nested-card",
    label: "Nested",
    document: {
      schemaVersion: "3.0.0",
      fabricVersion: "7.4.0",
      id: "widget",
      scene: {
        version: "7.4.0",
        objects: [
          {
            id: "group-nested-card",
            type: "Group",
            objects: [
              {
                id: "image",
                type: "image",
                left: 0,
                top: 0,
                [YUNARI_ASSET_PROPERTY]: { assetId, kind: "image" },
              },
            ],
          },
        ],
      },
    },
    declarations: [],
    assets: {},
  };
}

function declaration(id: string): AssetReference {
  return {
    id,
    kind: "image",
    path: `assets/${id}.png`,
    sha256: "a".repeat(64),
  };
}

describe("unitAssetDeclarations", () => {
  it("keeps only what the unit's own subtree references, through a group", () => {
    const declarations = [declaration("asset-a"), declaration("asset-b")];
    expect(
      unitAssetDeclarations(
        cardUnitFromWidget(nestedUnitWithAsset("asset-a")),
        declarations,
      ),
    ).toEqual([declaration("asset-a")]);
  });

  it("drops a face only the package globals name", () => {
    const face: FontAssetReference = {
      id: "face",
      kind: "font",
      path: "assets/face.woff2",
      sha256: "b".repeat(64),
      family: "Inter",
      weight: 400,
      style: "normal",
      format: "woff2",
    };
    expect(
      unitAssetDeclarations(cardUnitFromWidget(unitWithAsset("asset-a")), [
        declaration("asset-a"),
        face,
      ]),
    ).toEqual([declaration("asset-a")]);
  });
});

describe("a packaged widget unit", () => {
  it("remaps a packaged asset reference", () => {
    const copy = instantiateCard({
      unit: cardUnitFromWidget(unitWithAsset("asset-a")),
      globals: undefined,
      existingIds: [],
      assetIds: new Map([["asset-a", "asset-b"]]),
      origin: { left: 0, top: 0 },
    });
    expect(copy.card[YUNARI_ASSET_PROPERTY]).toEqual({
      assetId: "asset-b",
      kind: "image",
    });
  });

  it("leaves a reference the destination did not adopt visibly missing", () => {
    const copy = instantiateCard({
      unit: cardUnitFromWidget(unitWithAsset("asset-a")),
      globals: undefined,
      existingIds: [],
      assetIds: new Map(),
      origin: { left: 0, top: 0 },
    });
    expect(copy.card[YUNARI_ASSET_PROPERTY]).toEqual({
      assetId: "asset-a",
      kind: "image",
    });
  });

  it("keys the unit's glyph by its own id", () => {
    const unit = cardUnitFromWidget(unitWithAsset("asset-a"));
    expect(unit.id).toBe("group-image-card");
    expect(unit.diagram).toBe(unit.id);
    expect(unit.label).toBe("Image");
  });

  it("refuses a unit whose first scene object is not a record", () => {
    const unit = unitWithAsset("asset-a");
    expect(() =>
      cardUnitFromWidget({
        ...unit,
        document: {
          ...unit.document,
          scene: { version: "7.4.0", objects: [] },
        },
      }),
    ).toThrow(/group-image-card/);
  });
});
