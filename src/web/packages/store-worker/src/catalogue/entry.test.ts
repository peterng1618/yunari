import type { CatalogueEntry, FacetRecord } from "@yunari/renderer-core";
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
    publisher: "",
    review_state: "none",
    ...overrides,
  };
}

function versionRow(overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    item_id: ITEM_ID,
    version: "1.0.0",
    envelope_json: JSON.stringify({ schemaVersion: "3.0.0", metadata: {} }),
    facets_json: JSON.stringify(FACETS),
    metadata_json: "{}",
    execution_profile: null,
    review_state: "none",
    package_key: `packages/${ITEM_ID}/1.0.0.zip`,
    thumbnail_key: `thumbnails/${ITEM_ID}.png`,
    bytes: 1024,
    sha256: "0".repeat(64),
    created_at: UPDATED_AT,
    ...overrides,
  };
}

/** The tests below all read the entry, so a dropped row is their failure. */
function madeEntry(
  item: ItemRow,
  version: VersionRow,
  favorites: number,
  packageUrl: string,
  thumbnailUrl: string,
): CatalogueEntry {
  const entry = entryOf(item, version, favorites, packageUrl, thumbnailUrl);
  if (entry === undefined) throw new Error("The row did not make an entry.");
  return entry;
}

describe("entryOf", () => {
  it("maps a published row to the wire entry the parser accepts", () => {
    const entry = madeEntry(
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
    const entry = madeEntry(
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
      version: "3.0.0",
    };
    const entry = madeEntry(
      itemRow({ remix_of_id: remixOf.catalogueId }),
      versionRow({
        envelope_json: JSON.stringify({
          schemaVersion: "3.0.0",
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

  it("names a pack from its stored metadata, never the empty envelope", () => {
    const entry = madeEntry(
      itemRow({ kind: "widget-pack" }),
      versionRow({
        envelope_json: "{}",
        metadata_json: JSON.stringify({ name: "Starter Cards", units: [] }),
      }),
      0,
      "https://store.test/catalogue/x/1.0.0.zip",
      `catalogue/${ITEM_ID}/thumbnail.png`,
    );
    expect(entry).toMatchObject({ kind: "widget-pack", name: "Starter Cards" });
    expect(itemFileOf(entry)).not.toHaveProperty("remixOf");
    expect(itemFileOf(entry)).not.toHaveProperty("facets");
  });

  it("drops a pack whose stored metadata cannot name it", () => {
    const entry = entryOf(
      itemRow({ kind: "widget-pack" }),
      versionRow({ metadata_json: "{}" }),
      0,
      "https://store.test/catalogue/x/1.0.0.zip",
      `catalogue/${ITEM_ID}/thumbnail.png`,
    );
    expect(entry).toBeUndefined();
  });
});

describe("entryOf members", () => {
  const URL = "https://store.test/catalogue/x/1.0.0.zip";
  const THUMBNAIL = `catalogue/${ITEM_ID}/thumbnail.png`;

  it("derives one member for a dashboard theme", () => {
    const entry = madeEntry(
      itemRow(),
      versionRow({
        envelope_json: JSON.stringify({
          schemaVersion: "3.0.0",
          id: "theme-one",
          metadata: {},
        }),
      }),
      0,
      URL,
      THUMBNAIL,
    );
    expect(entry.members).toEqual([
      { id: "theme-one", kind: "dashboard-theme", name: "Yunari smoke theme" },
    ]);
  });

  it("derives one member for an editor theme", () => {
    const entry = madeEntry(
      itemRow({ kind: "editor-theme" }),
      versionRow({
        envelope_json: "{}",
        metadata_json: JSON.stringify({ name: "Graphite" }),
      }),
      0,
      URL,
      THUMBNAIL,
    );
    expect(entry.members).toEqual([
      { id: "Graphite", kind: "editor-theme", name: "Graphite" },
    ]);
  });

  it("derives a widget member per unit", () => {
    const entry = madeEntry(
      itemRow({ kind: "widget-pack" }),
      versionRow({
        envelope_json: "{}",
        metadata_json: JSON.stringify({
          name: "Starter Cards",
          units: [
            { id: "cpu", label: "CPU" },
            { id: "memory", label: "Memory" },
          ],
        }),
      }),
      0,
      URL,
      THUMBNAIL,
    );
    expect(entry.members).toEqual([
      { id: "cpu", kind: "widget", name: "CPU" },
      { id: "memory", kind: "widget", name: "Memory" },
    ]);
  });

  it("derives a shape member per preset", () => {
    const entry = madeEntry(
      itemRow({ kind: "path-preset-pack" }),
      versionRow({
        envelope_json: "{}",
        metadata_json: JSON.stringify({
          name: "Acme Shapes",
          presets: [{ id: "wave", label: "Wave" }],
        }),
      }),
      0,
      URL,
      THUMBNAIL,
    );
    expect(entry.members).toEqual([
      { id: "wave", kind: "shape", name: "Wave" },
    ]);
  });

  it("drops a pack whose member list could not be read", () => {
    // The derivation refuses input that names members it cannot parse; the row
    // is dropped rather than emitted with an empty list that reads as "none".
    const entry = entryOf(
      itemRow({ kind: "widget-pack" }),
      versionRow({
        envelope_json: "{}",
        metadata_json: JSON.stringify({ name: "Broken pack", units: "nope" }),
      }),
      0,
      URL,
      THUMBNAIL,
    );
    expect(entry).toBeUndefined();
  });

  it("maps plugin contributions to member kinds", () => {
    const entry = madeEntry(
      itemRow({ kind: "plugin" }),
      versionRow({
        envelope_json: "{}",
        metadata_json: JSON.stringify({
          name: "Plugin One",
          manifest: {
            contributes: {
              sensorProviders: [{ id: "acme", label: "Acme Sensors" }],
              assetCategories: [{ id: "static", label: "Static pictures" }],
              assetSources: [{ id: "pictures", label: "Pictures" }],
              panelFamilies: [{ id: "kraken", label: "Kraken" }],
              settingsPages: [{ id: "about", label: "About" }],
              customSources: [{ id: "weather", name: "Weather" }],
            },
          },
        }),
      }),
      0,
      URL,
      THUMBNAIL,
    );
    expect(entry.members).toEqual([
      { id: "acme", kind: "sensor-provider", name: "Acme Sensors" },
      { id: "weather", kind: "data-source", name: "Weather" },
      { id: "pictures", kind: "asset-source", name: "Pictures" },
      { id: "kraken", kind: "panel-driver", name: "Kraken" },
    ]);
  });

  it("serves includes and no members for a collection", () => {
    const included = [
      { id: "11111111-2222-4ccc-8ddd-555555555555", optional: false },
      { id: "99999999-8888-4777-8666-555555555555", optional: true },
    ];
    const entry = madeEntry(
      itemRow({ kind: "collection" }),
      versionRow({
        envelope_json: "{}",
        metadata_json: JSON.stringify({
          name: "Starter Kit",
          description: "Hand-picked.",
          includes: included,
        }),
      }),
      0,
      URL,
      THUMBNAIL,
    );
    // The wire keeps the author's optional default, so a catalogue row and the
    // package it was derived from agree about which members may be skipped.
    expect(entry).toMatchObject({
      kind: "collection",
      name: "Starter Kit",
      members: [],
      includes: included,
    });
  });
});

describe("indexDocument", () => {
  it("stamps the caller's instant verbatim", () => {
    const entries = [
      madeEntry(itemRow(), versionRow(), 1, "u", "catalogue/x/thumbnail.png"),
    ];
    expect(indexDocument(entries, NOW)).toEqual({
      generatedAt: NOW,
      entries,
    });
  });
});
