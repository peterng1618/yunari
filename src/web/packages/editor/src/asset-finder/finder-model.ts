import {
  type AssetResult,
  type AssetSourceListing,
  BUILTIN_LISTING_CATEGORIES,
  type BuiltinListingCategory,
  type DeclarativeCategory,
  type ListingCategory,
  type PresetKind,
} from "@yunari/renderer-core";
import { uiCopy } from "../ui-copy.js";
import type { WallpaperEngineItem } from "../wallpaper-engine/client.js";
import { EMPTY_TAB, type FinderRow, type TabData } from "./tab-data.js";

/** How long a keystroke settles before it is the query. */
export const SEARCH_DEBOUNCE_MS = 200;

export const DISABLED_KEY = "yunari.asset-finder.disabled";

/** The kind filter's own value: every source, or one preset kind. */
export type KindFilter = "all" | PresetKind;

/** The rail's order: the built-in categories, in the order the product ships
 *  them. A category the registry adds later that this list does not name
 *  appends alphabetically rather than disappearing. */
export const CATEGORY_ORDER: readonly ListingCategory[] =
  BUILTIN_LISTING_CATEGORIES;

/**
 * The open tab list: every built-in category in its own order, then the ids
 * this build does not name — declared by a plugin or listed by a source —
 * sorted. A built-in id keeps its place however it was reached.
 */
export function categoryTabs(
  declared: readonly DeclarativeCategory[],
  listing: readonly { readonly category: ListingCategory }[],
): readonly ListingCategory[] {
  const builtin = new Set<string>(BUILTIN_LISTING_CATEGORIES);
  const appendix = new Set<string>();

  for (const entry of declared) {
    if (!builtin.has(entry.id)) appendix.add(entry.id);
  }
  for (const source of listing) {
    if (!builtin.has(source.category)) appendix.add(source.category);
  }

  return [...BUILTIN_LISTING_CATEGORIES, ...[...appendix].sort()];
}

/** A built-in copy table's word for an open category, or `undefined` when the
 *  table does not name it. The cast is the one doorway an open key needs: the
 *  tables stay keyed by `BuiltinListingCategory`, so a missing built-in word is
 *  still a compile error. */
export function categoryWord(
  table: Readonly<Record<BuiltinListingCategory, string>>,
  category: ListingCategory,
): string | undefined {
  // A plugin id may be `constructor`, which is inherited from `Object` rather
  // than named by the table. Only an own key is the table's word.
  return Object.hasOwn(table, category)
    ? (table as Readonly<Record<string, string | undefined>>)[category]
    : undefined;
}

/** The word a tab shows: the copy table's own word for a built-in category,
 *  and the id itself for one this build does not name. */
export function categoryLabel(category: ListingCategory): string {
  return categoryWord(uiCopy.assets.category, category) ?? category;
}

/** A sentence a write left for one result; `failedId` names the result the
 *  sentence answers, so a later choice does not inherit its mark. */
export interface TabMessage {
  readonly text: string;
  readonly tone: "ok" | "failed";
  readonly failedId?: string;
}

/** One tab's accumulation and its own UI state, so switching tabs restores the
 *  question, the rows and the selection instead of resetting them. */
export interface TabView {
  readonly data: TabData;
  readonly browsed: boolean;
  readonly loading: "first" | "more" | undefined;
  readonly selection: FinderRow | undefined;
  readonly message: TabMessage | undefined;
}

export const EMPTY_VIEW: TabView = {
  data: EMPTY_TAB,
  browsed: false,
  loading: undefined,
  selection: undefined,
  message: undefined,
};

/** Only the built-in tabs start with a view; a declared category is read
 *  through `viewOf` rather than pre-populated for an id nothing knows. */
export function emptyViews(): Record<string, TabView> {
  const views: Record<string, TabView> = {};
  for (const category of CATEGORY_ORDER) views[category] = EMPTY_VIEW;
  return views;
}

/** A tab's own view, or the empty one for a category nothing has drawn yet. A
 *  plugin id may be `constructor` or `toString`; an inherited `Object` key is
 *  not a view, so only an own key is returned. */
export function viewOf(
  views: Readonly<Record<string, TabView>>,
  category: ListingCategory,
): TabView {
  return Object.hasOwn(views, category)
    ? (views[category] as TabView)
    : EMPTY_VIEW;
}

export type ActionOutcome =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly message: string };

/** The Wallpaper Engine tab: a library fetched once, narrowed in memory. It
 *  has no page cursor and no request per keystroke, so it keeps its own small
 *  state rather than the search tabs' `TabData`. */
export interface LocalView {
  readonly query: string;
  readonly kind: "all" | WallpaperEngineItem["kind"];
  readonly selection: WallpaperEngineItem | undefined;
  readonly done: ReadonlySet<string>;
  readonly message: TabMessage | undefined;
}

export const EMPTY_LOCAL: LocalView = {
  query: "",
  kind: "all",
  selection: undefined,
  done: new Set(),
  message: undefined,
};

/** What the double-clicked card was: a search grid's row or a library item.
 *  The preview carries that target's own actions, not the footer's selection. */
export type PreviewTarget =
  | { readonly kind: "asset"; readonly row: FinderRow }
  | { readonly kind: "local"; readonly item: WallpaperEngineItem };

export function storedDisabled(): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(DISABLED_KEY) ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function gridSourcesOf(
  sources: readonly AssetSourceListing[],
  category: ListingCategory,
): readonly AssetSourceListing[] {
  // A font source searches through the same grid; its request body differs, not
  // its place in the window (R5).
  return sources.filter(
    (source) =>
      source.category === category &&
      (source.body === "grid" ||
        (category === "font" && source.body === "font-picker")),
  );
}

/** The source a result id names: the host prefixes ids `<source>:<entry>`. */
export function sourceIdOf(result: AssetResult): string {
  const at = result.id.indexOf(":");
  return at === -1 ? result.id : result.id.slice(0, at);
}

/** The request field that says which editor body asks; the grid is the default
 *  and is spelled out so the host never has to infer it. */
export function bodyOf(category: ListingCategory): "grid" | "font-picker" {
  return category === "font" ? "font-picker" : "grid";
}
