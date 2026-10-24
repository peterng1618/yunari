import type { FacetRecord } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import type { ItemRow, VersionRow } from "../db/types.js";
import { entryOf, indexDocument, itemFileOf } from "./entry.js";

const ITEM_ID = "6041df49-9c61-4d51-a184-716890560bdb";
const CREATED_AT = "2026-10-01T00:00:00.000Z";
const UPDATED_AT = "2026-10-20T00:00:00.000Z";
const NOW = "2026-10-23T00:00:00.000Z";

const FACETS: FacetRecord = {
  author: "Huy",
  colourMode: "dark",
  sensors: [{ key: "cpu.usage", label: "CPU", family: "cpu" }],
  tags: ["minimal"],
  orientation: "landscape",
  aspect: "16:9",
  width: 1280,
  height: 720,
};

function itemRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: ITEM_ID,
    kind: "dashboard-theme",
    author_user_id: "user-1",
    name: "Yunari smoke theme",
    status: "published",
    status_reason: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    published_at: UPDATED_AT,
    unpublished_at: null,
    removed_at: null,
    downloads: 3,
    remix_of_id: null,
    ...overrides,
  };
}

function versionRow(overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    item_id: ITEM_ID,
    version: "1.0.0",
    envelope_json: JSON.stringify({ schemaVersion: "2.0.0", metadata: {} }),
    facets_json: JSON.stringify(FACETS),
    package_key: `packages/${ITEM_ID}/1.0.0.zip`,
    thumbnail_key: `thumbnails/${ITEM_ID}.png`,
    bytes: 1024,
    sha256: "0".repeat(64),
    created_at: UPDATED_AT,
    ...overrides,
  };
}

describe("entryOf", () => {
  it("maps a published row to the wire entry the parser accepts", () => {
    const entry = entryOf(
      itemRow(),
      versionRow(),
      7,
      "https://store.test/catalogue/6041df49-9c61-4d51-a184-716890560bdb/1.0.0.zip",
      `catalogue/${ITEM_ID}/thumbnail.png`,
    );
    expect(entry).toMatchObject({
      id: ITEM_ID,
      kind: "dashboard-theme",
      downloads: 3,
      favorites: 7,
      version: "1.0.0",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
    expect(indexDocument([entry], NOW).entries).toHaveLength(1);
    expect(itemFileOf(entry)).not.toHaveProperty("facets");
  });

  it("keeps the thumbnail a stored path and omits an absent credit", () => {
    const entry = entryOf(
      itemRow(),
      versionRow(),
      0,
      "https://store.test/catalogue/x/1.0.0.zip",
      `catalogue/${ITEM_ID}/thumbnail.png`,
    );
    expect(entry.thumbnail).toBe(`catalogue/${ITEM_ID}/thumbnail.png`);
    expect(entry).not.toHaveProperty("remixOf");
    expect(itemFileOf(entry)).not.toHaveProperty("id");
    expect(itemFileOf(entry).thumbnail).toBe(entry.thumbnail);
  });

  it("takes the remix credit from the stored envelope", () => {
    const remixOf = {
      catalogueId: "11111111-2222-3333-4444-555555555555",
      name: "Parent",
      version: "2.1.0",
    };
    const entry = entryOf(
      itemRow({ remix_of_id: remixOf.catalogueId }),
      versionRow({
        envelope_json: JSON.stringify({
          schemaVersion: "2.0.0",
          metadata: { remixOf },
        }),
      }),
      0,
      "https://store.test/catalogue/x/1.0.0.zip",
      `catalogue/${ITEM_ID}/thumbnail.png`,
    );
    expect(entry.remixOf).toEqual(remixOf);
    expect(itemFileOf(entry).remixOf).toEqual(remixOf);
  });
});

describe("indexDocument", () => {
  it("stamps the caller's instant verbatim", () => {
    const entries = [
      entryOf(itemRow(), versionRow(), 1, "u", "catalogue/x/thumbnail.png"),
    ];
    expect(indexDocument(entries, NOW)).toEqual({
      generatedAt: NOW,
      entries,
    });
  });
});
