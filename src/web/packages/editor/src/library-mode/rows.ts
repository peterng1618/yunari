import type { CatalogueOrigin } from "@yunari/renderer-core";
import { withInstalledVersions } from "../store-mode/install-state.js";
import type { StoreItem } from "../store-mode/local-source.js";
import { collectionStateOf } from "./cards.js";
import type { LibraryState } from "./sources.js";

/** One row, tagged with the half it was read from. The tag is what keeps a
 *  library row in "On this PC" whatever its origin says. */
export interface Row {
  readonly item: StoreItem;
  readonly half: "store" | "library";
}

/**
 * The two halves joined, then filtered by the state.
 *
 * **A library row that names a catalogue item is that item's installed copy**,
 * so the library half drops it when the catalogue listing actually carries that
 * item; the catalogue row takes the origin the library row carried. A library
 * row whose catalogue id the listing does not carry — an unpublished entry, a
 * page that stopped browsing that kind, or a catalogue half that failed — stays
 * its own row, or the installed copy would vanish with nothing left to remove.
 *
 * The rule is one function because the filter and the grid must not disagree
 * about which rows the state admits.
 *
 * **A collection's installed state is its includes'**, so the filter reads
 * `collectionStateOf` rather than the row's own origin, which a collection
 * never has. A partially installed collection is *On this PC*: it has copies on
 * this PC and reads its count with Update. Only a collection with no include
 * installed is *Not installed*.
 */
export function rowsFor(
  catalogue: readonly StoreItem[],
  library: readonly StoreItem[],
  state: LibraryState,
  origins: readonly CatalogueOrigin[] | undefined,
): readonly Row[] {
  const byCatalogueId = new Map<string, CatalogueOrigin>();
  for (const item of library) {
    if (item.origin !== undefined) {
      byCatalogueId.set(item.origin.catalogueId, item.origin);
    }
  }
  const store = withInstalledVersions(catalogue, library).map((item) => {
    const origin = byCatalogueId.get(item.id);
    return origin === undefined ? item : { ...item, origin };
  });
  const listed = new Set(store.map((item) => item.id));
  const libraryOnly = library.filter(
    (item) => item.origin === undefined || !listed.has(item.origin.catalogueId),
  );
  const rows: readonly Row[] = [
    ...store.map((item): Row => ({ item, half: "store" })),
    ...libraryOnly.map((item): Row => ({ item, half: "library" })),
  ];

  if (state === "all") return rows;

  const collectionOf = (row: Row) =>
    origins === undefined ? undefined : collectionStateOf(row.item, origins);
  /** **A collection is neither side until the register answers.** Its state is
   *  counted over the register, so an unread register would draw an installed
   *  collection as "Not installed" and hide it from "On this PC". */
  const unclassified = (row: Row): boolean =>
    origins === undefined && row.item.includes !== undefined;

  if (state === "on-this-pc") {
    return rows.filter((row) => {
      if (unclassified(row)) return false;
      if (row.half === "library" || row.item.origin !== undefined) return true;
      const collection = collectionOf(row);
      return collection !== undefined && collection.state !== "absent";
    });
  }
  return rows.filter((row) => {
    if (unclassified(row)) return false;
    const collection = collectionOf(row);
    if (collection !== undefined) return collection.state === "absent";
    return row.half === "store" && row.item.origin === undefined;
  });
}
