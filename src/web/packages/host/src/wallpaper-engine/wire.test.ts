import { describe, expect, it } from "vitest";
import type { LibraryItem } from "./library.js";
import type { ItemPayload } from "./resolve.js";
import { toStoredItem } from "./wire.js";

const ITEM: LibraryItem = {
  workshopId: "101",
  directory: "/library/101",
  title: "Cache Scene",
  payload: "/library/101/scene.pkg",
  type: "scene",
  preview: "/library/101/preview.jpg",
  filesize: 1234,
  tags: ["Abstract"],
  authorSteamId: "76561198000000001",
  workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=101",
  properties: { brightness: { type: "color" } },
};

const SCENE: ItemPayload = { kind: "scene", path: ITEM.payload };

describe("the JSON the browser receives (§5.2)", () => {
  it("takes the kind from the resolved payload", () => {
    const stored = toStoredItem(ITEM, { kind: "web" });

    expect(stored.kind).toBe("web");
  });

  it("carries both attribution fields when the cache row has them", () => {
    expect(toStoredItem(ITEM, SCENE).attribution).toEqual({
      steamId: "76561198000000001",
      workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=101",
    });
  });

  it("keeps only the attribution field that exists", () => {
    const stored = toStoredItem({ ...ITEM, workshopUrl: undefined }, SCENE);

    expect(stored.attribution).toEqual({ steamId: "76561198000000001" });
  });

  it("omits attribution entirely when there is no cache row", () => {
    const stored = toStoredItem(
      { ...ITEM, authorSteamId: undefined, workshopUrl: undefined },
      SCENE,
    );

    expect("attribution" in stored).toBe(false);
  });

  it("carries the scene facts only when they were measured", () => {
    expect("stillAtRest" in toStoredItem(ITEM, SCENE)).toBe(false);

    const classified = toStoredItem(ITEM, SCENE, {
      atRest: true,
      hasText: false,
    });

    expect(classified.stillAtRest).toBe(true);
    expect(classified.hasText).toBe(false);
  });

  it("points the preview at the item's own route", () => {
    expect(toStoredItem(ITEM, SCENE).previewUrl).toBe(
      "/api/wallpaper-engine/item/101/preview",
    );
    expect(
      "previewUrl" in toStoredItem({ ...ITEM, preview: undefined }, SCENE),
    ).toBe(false);
  });

  it("encodes an id that came from a third-party descriptor", () => {
    expect(
      toStoredItem({ ...ITEM, workshopId: "we ird/id" }, SCENE).previewUrl,
    ).toBe("/api/wallpaper-engine/item/we%20ird%2Fid/preview");
  });
});
