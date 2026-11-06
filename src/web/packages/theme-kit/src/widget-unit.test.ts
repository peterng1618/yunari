// @vitest-environment node

import { YUNARI_ASSET_PROPERTY } from "@yunari/scene-fabric";
import type { WidgetUnit } from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import { instantiateCard } from "./card-library.js";
import { cardUnitFromWidget } from "./widget-unit.js";

/** One packaged unit whose only object draws a declared image. */
function unitWithAsset(assetId: string): WidgetUnit {
  return {
    id: "group-image-card",
    label: "Image",
    document: {
      schemaVersion: "2.0.0",
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
