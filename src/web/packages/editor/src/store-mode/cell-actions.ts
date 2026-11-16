import type { CellAction, StoreItem } from "./local-source.js";

/**
 * The action ids each member kind offers, in the order its foot draws them.
 *
 * **The kind is the member's, not the package's.** A widget card opened from a
 * widget pack inserts that widget; the pack itself is the listing's card and
 * draws no member action. A plugin's cards are its contributions, so the
 * sensor-provider, data-source, asset-source and panel-driver words are what
 * select their commands.
 *
 * A kind this build does not ship answers no actions: the surface prints the
 * identifier and offers nothing it cannot explain.
 */
const ACTIONS_BY_KIND: Readonly<Record<string, readonly CellAction[]>> = {
  "dashboard-theme": ["open", "assign", "export", "delete"],
  "editor-theme": ["apply", "export", "delete"],
  widget: ["insert", "remove"],
  shape: ["insert", "remove"],
  "sensor-provider": ["enable", "configure", "remove"],
  "data-source": ["enable", "configure", "remove"],
  "asset-source": ["enable", "configure", "remove"],
  "panel-driver": ["assign", "status", "remove"],
  // A package's own card draws the one command that acts on the package; its
  // member cards draw the member's actions.
  "widget-pack": ["remove"],
  "path-preset-pack": ["remove"],
  plugin: ["remove"],
  // A collection's Install or Update is its install press
  // (`collectionStateOf`), drawn in place of the library actions; Remove
  // members is the one action this union carries for it.
  collection: ["remove"],
};

const NO_ACTIONS: readonly CellAction[] = [];

/** The actions one member kind allows. `Object.hasOwn` keeps a kind named
 *  `constructor` or `__proto__` from answering the map's prototype instead of
 *  the empty set, the rule the facet table follows. */
export function actionsFor(kind: string): readonly CellAction[] {
  return Object.hasOwn(ACTIONS_BY_KIND, kind)
    ? (ACTIONS_BY_KIND[kind] as readonly CellAction[])
    : NO_ACTIONS;
}

/**
 * The catalogue collections an item belongs to.
 *
 * **Membership is derived from the collection's `includes`**, never from a
 * reverse field on the item: the collection is the one owner of what it
 * installs, and a second copy on every member would drift. `itemId` is the
 * catalogue id the collection names — the item's own id in the catalogue, or
 * the id its installed copy records in `origin`.
 */
export function collectionsOf(
  items: readonly StoreItem[],
  itemId: string,
): readonly StoreItem[] {
  return items.filter(
    (item) => item.kind === "collection" && item.includes?.includes(itemId),
  );
}

/**
 * Why a cell's action is drawn disabled, or `undefined` for one a build runs.
 *
 * The surface gives every cell four actions and the item's footer the same four,
 * so all four stay drawn (R164) — and the one **no task in this plan and no
 * phase owns** is disabled where it is drawn, with its reason, rather than
 * answering a press with nothing. One owner for that fact, because the cell and
 * the footer both draw the four and a second list would be a second answer to
 * "does this action run".
 *
 * It is total over `CellAction`, so an action added to the union fails to compile
 * here rather than arriving silently live. A phase that takes one up moves it out
 * of this map in the same change — and the region's `onAction` with it.
 *
 * **Delete runs through the host's own removal route**, which moves the theme's
 * folder to the recycle bin, so the action is live and the region drops the item
 * after the host accepts it. **Export reads the stored theme and writes the
 * package the format documents**, so the region owns the download and this map
 * has no disabled action left. The kinds' wider actions are live: each is
 * reported through the same callback, and a surface that has not taken one up
 * yet still reports the press rather than drawing a dead control.
 */
export const CELL_ACTION_REASONS: Readonly<
  Record<CellAction, string | undefined>
> = {
  open: undefined,
  assign: undefined,
  export: undefined,
  delete: undefined,
  apply: undefined,
  insert: undefined,
  enable: undefined,
  configure: undefined,
  status: undefined,
  remove: undefined,
};
