import type { ControlOption } from "../components/ui/control-select.js";
import type { StoreItem } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";

/**
 * How the joined listing is ordered: the keys the sort well offers, the key the
 * page opens on, and the comparison behind each key.
 *
 * The one listing holds both halves' rows, so the keys are the facts either can
 * carry: a name and an updated instant from this PC's copies, and the
 * catalogue's published instant and counts where a row has them. A row that
 * cannot answer a key compares equal and stays where it is.
 */
export const SORT_KEYS: readonly ControlOption[] = [
  { id: "name", name: uiCopy.store.sort.name },
  { id: "updated", name: uiCopy.store.sort.updated },
  { id: "created", name: uiCopy.store.sort.created },
  { id: "downloads", name: uiCopy.store.sort.downloads },
  { id: "favorites", name: uiCopy.store.sort.favorites },
];

/** What every page opens on: the row that changed most recently. */
export const DEFAULT_SORT = "updated";

/** A catalogue date, newest first. **An item carrying no catalogue facts** — a
 *  row only this PC holds — **has no place in an order it cannot answer**, so it
 *  compares equal and stays where it is. */
function newestFirst(
  reading: (item: StoreItem) => string | undefined,
): (a: StoreItem, b: StoreItem) => number {
  return (a, b) => (reading(b) ?? "").localeCompare(reading(a) ?? "");
}

/** A catalogue count, most first, with `newestFirst`'s no-comparison guard. */
function mostFirst(
  reading: (item: StoreItem) => number | undefined,
): (a: StoreItem, b: StoreItem) => number {
  return (a, b) => {
    const left = reading(a);
    const right = reading(b);
    return left === undefined || right === undefined ? 0 : right - left;
  };
}

/**
 * The orders the well offers, keyed by the sort key it declares.
 *
 * **A date is newest first and a count is most first**: the item that changed
 * most recently is the one a person is looking for, an ISO instant sorts as a
 * string, and "most downloaded" means most. A library row has no published
 * instant and no counts, so those keys leave it in place.
 */
export const SORT_ORDERS: Readonly<
  Record<string, (a: StoreItem, b: StoreItem) => number>
> = {
  name: (a, b) => a.name.localeCompare(b.name),
  updated: newestFirst((item) => item.catalogue?.updatedAt ?? item.updatedAt),
  created: newestFirst((item) => item.catalogue?.createdAt),
  downloads: mostFirst((item) => item.catalogue?.downloads),
  favorites: mostFirst((item) => item.catalogue?.favorites),
};
