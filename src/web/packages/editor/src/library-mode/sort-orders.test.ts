import { defaultFacetsFor } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import type { StoreItem } from "../store-mode/local-source.js";
import { DEFAULT_SORT, SORT_KEYS, SORT_ORDERS } from "./sort-orders.js";

/** One row with only the facts a sort key reads. */
function item(
  name: string,
  extra: {
    readonly updatedAt?: string;
    readonly createdAt?: string;
    readonly downloads?: number;
    readonly favorites?: number;
  } = {},
): StoreItem {
  const { updatedAt, createdAt, downloads, favorites } = extra;
  return {
    id: name,
    kind: "dashboard-theme",
    name,
    members: [{ id: name, kind: "dashboard-theme", name }],
    author: undefined,
    version: undefined,
    updatedAt,
    thumbnailUrl: undefined,
    ground: undefined,
    origin: undefined,
    catalogue:
      createdAt === undefined &&
      downloads === undefined &&
      favorites === undefined
        ? undefined
        : {
            id: name,
            createdAt: createdAt ?? "2026-01-01T00:00:00.000Z",
            updatedAt: updatedAt ?? "2026-01-01T00:00:00.000Z",
            downloads: downloads ?? 0,
            favorites: favorites ?? 0,
            packageUrl: `https://store.test/${name}.zip`,
            installedVersion: undefined,
          },
    facets: defaultFacetsFor("dashboard-theme"),
  };
}

function ids(items: readonly StoreItem[]): readonly string[] {
  return items.map((row) => row.id);
}

describe("the listing's sort orders", () => {
  it("opens on the row that changed most recently", () => {
    expect(DEFAULT_SORT).toBe("updated");
    const rows = [
      item("older", { updatedAt: "2026-10-01T00:00:00.000Z" }),
      item("newer", { updatedAt: "2026-10-14T00:00:00.000Z" }),
    ];
    expect(ids([...rows].sort(SORT_ORDERS[DEFAULT_SORT]))).toEqual([
      "newer",
      "older",
    ]);
  });

  it("orders by name", () => {
    const rows = [item("Zebra"), item("Aardvark")];
    expect(ids([...rows].sort(SORT_ORDERS["name"]))).toEqual([
      "Aardvark",
      "Zebra",
    ]);
  });

  it("orders a count most first and a date newest first", () => {
    const rows = [
      item("few", {
        downloads: 2,
        favorites: 1,
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
      item("many", {
        downloads: 9,
        favorites: 4,
        createdAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    expect(ids([...rows].sort(SORT_ORDERS["downloads"]))).toEqual([
      "many",
      "few",
    ]);
    expect(ids([...rows].sort(SORT_ORDERS["favorites"]))).toEqual([
      "many",
      "few",
    ]);
    expect(ids([...rows].sort(SORT_ORDERS["created"]))).toEqual([
      "few",
      "many",
    ]);
  });

  it("leaves a row in place for a key it cannot answer", () => {
    // A library row has no catalogue counts, so `downloads` has nothing to
    // compare and the row keeps its place rather than sorting as zero.
    const rows = [item("local"), item("listed", { downloads: 3 })];
    expect(ids([...rows].sort(SORT_ORDERS["downloads"]))).toEqual([
      "local",
      "listed",
    ]);
    expect(SORT_KEYS.map((key) => key.id)).toEqual([
      "name",
      "updated",
      "created",
      "downloads",
      "favorites",
    ]);
  });
});
