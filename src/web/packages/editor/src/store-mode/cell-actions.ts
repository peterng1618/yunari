import { pathPresetPackIdOf } from "@yunari/theme-package";
import { keyPath } from "../plugin-manager/use-extensions.js";
import { uiCopy } from "../ui-copy.js";
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
const ACTIONS_BY_KIND = {
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
} as const satisfies Readonly<Record<string, readonly CellAction[]>>;

/**
 * The kinds whose card can draw `remove`, derived from the one action table so
 * a kind that gains the action cannot leave a copy table behind. `uiCopy`'s
 * removal words are total over this union.
 */
export type RemovalKind = {
  [K in keyof typeof ACTIONS_BY_KIND]: "remove" extends (typeof ACTIONS_BY_KIND)[K][number]
    ? K
    : never;
}[keyof typeof ACTIONS_BY_KIND];

export function isRemovalKind(kind: string): kind is RemovalKind {
  return (
    Object.hasOwn(ACTIONS_BY_KIND, kind) &&
    (
      ACTIONS_BY_KIND[
        kind as keyof typeof ACTIONS_BY_KIND
      ] as readonly CellAction[]
    ).includes("remove")
  );
}

/**
 * Whether a kind's card is code — a provider, a source or a driver — derived
 * from the actions only such a kind offers. A second spelling of the set would
 * let the trust block and the foot disagree about what counts as code.
 */
const CODE_ACTIONS: ReadonlySet<CellAction> = new Set([
  "enable",
  "configure",
  "status",
]);

export function isCodeKind(kind: string): boolean {
  return actionsFor(kind).some((action) => CODE_ACTIONS.has(action));
}

const NO_ACTIONS: readonly CellAction[] = [];

/** The actions one member kind allows. `Object.hasOwn` keeps a kind named
 *  `constructor` or `__proto__` from answering the map's prototype instead of
 *  the empty set, the rule the facet table follows. */
export function actionsFor(kind: string): readonly CellAction[] {
  return Object.hasOwn(ACTIONS_BY_KIND, kind)
    ? ((ACTIONS_BY_KIND as Readonly<Record<string, readonly CellAction[]>>)[
        kind
      ] ?? NO_ACTIONS)
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
    (item) =>
      item.kind === "collection" &&
      item.includes?.some((include) => include.id === itemId) === true,
  );
}

/**
 * The actions a kind can run, because a host route exists for them.
 *
 * **R27: a live control is a wired control.** Every other action a surface draws
 * is disabled and states why, so no press falls to a "not available yet"
 * notice. The one owner is here, beside the kind table, because the cell and the
 * foot must not disagree about what runs.
 */
const RUNNABLE_ACTIONS: Readonly<
  Partial<Record<string, ReadonlySet<CellAction>>>
> = {
  "dashboard-theme": new Set(["open", "assign", "export", "delete"]),
  // An app theme has no write route: the host serves its bytes and nothing
  // else, so Apply, Export and Delete stay disabled rather than dead controls.
  "editor-theme": new Set(),
  // **A removal is not the kind's alone**: it also needs an installed copy and a
  // route that names that copy, which `actionDisabledReason` reads from the row.
  // A single widget has no route of its own — its pack does — so a widget
  // member's Remove stays disabled rather than deleting the package.
  widget: new Set(),
  // A pack's preset row is removed with its pack, never alone.
  shape: new Set(["remove"]),
  "sensor-provider": new Set(["remove"]),
  "data-source": new Set(["remove"]),
  "asset-source": new Set(["remove"]),
  "panel-driver": new Set(["remove"]),
  "widget-pack": new Set(["remove"]),
  "path-preset-pack": new Set(["remove"]),
  plugin: new Set(["remove"]),
  // No bulk removal exists, so a collection's `remove` is disabled; the install
  // sheet's diff names where each member is removed instead.
  collection: new Set(),
};

const NO_RUNNABLE: ReadonlySet<CellAction> = new Set();

/** Whether a host route exists for one action on one kind. */
export function isActionRunnable(action: CellAction, kind: string): boolean {
  return (
    Object.hasOwn(RUNNABLE_ACTIONS, kind) &&
    (RUNNABLE_ACTIONS[kind] ?? NO_RUNNABLE).has(action)
  );
}

/** Whether this row holds a copy a removal route could act on. A catalogue row
 *  that was never installed has nothing to remove. */
function holdsACopy(item: StoreItem): boolean {
  return (
    item.catalogue === undefined ||
    item.installedId !== undefined ||
    item.origin !== undefined
  );
}

/** Why a control is drawn disabled, or `undefined` for one that runs. `label`
 *  is the pressed command's own word, so the reason names the control a person
 *  is looking at. `item` is the row the press would act on: a removal needs both
 *  a copy and a route that names it. */
export function actionDisabledReason(
  action: CellAction,
  kind: string,
  label: string,
  item: StoreItem,
): string | undefined {
  if (action === "remove") {
    if (kind === "collection") {
      return uiCopy.store.collectionSheet.update.droppedLead;
    }
    const route = removalPath(kind, item.installedId ?? item.id);
    if (route !== undefined && holdsACopy(item)) return undefined;
    return uiCopy.library.actionUnavailable(label);
  }
  if (isActionRunnable(action, kind)) return undefined;
  return uiCopy.library.actionUnavailable(label);
}

/**
 * The host route that removes one kind's copy, or `undefined` when the kind has
 * none. **The id is the library copy's**, not the catalogue's, so a joined
 * catalogue row passes `installedId`. A plugin key is `publisher/id`, encoded
 * by the extension client's own `keyPath`: the host route reads two segments,
 * and a single encoded segment answers 404. A pack's preset row (`pack:…`) is
 * removed with its pack: the row names the pack, so its Remove is the pack's
 * route rather than the single-preset one.
 */
export function removalPath(kind: string, id: string): string | undefined {
  if (
    kind === "plugin" ||
    kind === "sensor-provider" ||
    kind === "data-source" ||
    kind === "asset-source" ||
    kind === "panel-driver"
  ) {
    return `/api/extensions/${keyPath(id)}`;
  }
  if (kind === "widget-pack") {
    return `/api/widget-packs/${encodeURIComponent(id)}`;
  }
  if (kind === "shape") {
    const packId = pathPresetPackIdOf(id);
    return packId === undefined
      ? `/api/path-presets/${encodeURIComponent(id)}`
      : `/api/path-presets/packs/${encodeURIComponent(packId)}`;
  }
  if (kind === "path-preset-pack") {
    const packId = pathPresetPackIdOf(id) ?? id;
    return `/api/path-presets/packs/${encodeURIComponent(packId)}`;
  }
  return undefined;
}

/**
 * The kinds whose package carries a theme document, classified beside the kind
 * table rather than inferred from a `defaultFacetsFor` record. Only these draw
 * the Shape group and the stage's size caption; a widget, plugin or collection
 * has no artboard, and its default record (a 1×1 square) is not a reading.
 */
const THEME_DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  "dashboard-theme",
  "editor-theme",
]);

export function carriesThemeDocument(kind: string): boolean {
  return THEME_DOCUMENT_KINDS.has(kind);
}
