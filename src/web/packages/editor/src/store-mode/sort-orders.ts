import type { ControlOption } from "../components/ui/control-select.js";
import { uiCopy } from "../ui-copy.js";
import type { CatalogueFacts, StoreItem } from "./local-source.js";
// Type-only: the union is the region's own, and erasing this import leaves no
// cycle in the module graph.
import type { StoreTab } from "./region.js";

/**
 * How the store's two halves are ordered: the keys each half offers, the key it
 * opens on, and the comparison behind each key.
 *
 * It lives beside the region rather than inside it because the region is a
 * surface at its line stop, and an order is a fact about the listing rather
 * than something the surface draws.
 */

/**
 * The sort keys, per half, because the two share none: the catalogue knows when
 * an item was published and how often it was taken, and the host's library knows
 * only what the author wrote.
 *
 * A key names the order the row offers, not necessarily a field: the catalogue
 * carries `createdAt`/`updatedAt` and offers them as `created`/`updated`, so
 * `SORT_ORDERS` below is the one place that says which fact an id reads.
 */
export const SORT_KEYS: Readonly<Record<StoreTab, readonly ControlOption[]>> = {
  local: [
    { id: "name", name: uiCopy.store.sort.local.name },
    { id: "updatedAt", name: uiCopy.store.sort.local.updatedAt },
  ],
  online: [
    { id: "created", name: uiCopy.store.sort.online.created },
    { id: "updated", name: uiCopy.store.sort.online.updated },
    { id: "downloads", name: uiCopy.store.sort.online.downloads },
    { id: "favorites", name: uiCopy.store.sort.online.favorites },
  ],
};

/** What each half opens on: the library by `updatedAt` and the catalogue by
 *  `updated` — **newest first**, the theme that changed most recently — which is
 *  the order each half is browsed in. */
export const DEFAULT_SORT: Readonly<Record<StoreTab, string>> = {
  local: "updatedAt",
  online: "updated",
};

/**
 * A catalogue date, newest first. **An item carrying no catalogue facts** — a
 * library item under a catalogue key — **has no place in an order it cannot
 * answer**, so it compares equal and stays where it is.
 */
function newestFirst(
  reading: (facts: CatalogueFacts) => string,
): (a: StoreItem, b: StoreItem) => number {
  return (a, b) => {
    const left = a.catalogue;
    const right = b.catalogue;
    return left === undefined || right === undefined
      ? 0
      : reading(right).localeCompare(reading(left));
  };
}

/** A catalogue count, most first, with `newestFirst`'s no-comparison guard. */
function mostFirst(
  reading: (facts: CatalogueFacts) => number,
): (a: StoreItem, b: StoreItem) => number {
  return (a, b) => {
    const left = a.catalogue;
    const right = b.catalogue;
    return left === undefined || right === undefined
      ? 0
      : reading(right) - reading(left);
  };
}

/**
 * The orders the row offers, keyed by the sort key it declares — both halves'
 * keys, which share no member.
 *
 * **A date is newest first and a count is most first**: the item that changed
 * most recently is the one a person is looking for, an ISO instant sorts as a
 * string, and "most downloaded" means most.
 */
export const SORT_ORDERS: Readonly<
  Record<string, (a: StoreItem, b: StoreItem) => number>
> = {
  name: (a, b) => a.name.localeCompare(b.name),
  updatedAt: (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  created: newestFirst((facts) => facts.createdAt),
  updated: newestFirst((facts) => facts.updatedAt),
  downloads: mostFirst((facts) => facts.downloads),
  favorites: mostFirst((facts) => facts.favorites),
};
