import type {
  AssetResult,
  AssetSourceListing,
  ListingCategory,
  PresetKind,
} from "@yunari/renderer-core";
import type { WallpaperEngineItem } from "../wallpaper-engine/client.js";
import { EMPTY_TAB, type FinderRow, type TabData } from "./tab-data.js";

/** How long a keystroke settles before it is the query. */
export const SEARCH_DEBOUNCE_MS = 200;

export const DISABLED_KEY = "yunari.asset-finder.disabled";

/** The kind filter's own value: every source, or one preset kind. */
export type KindFilter = "all" | PresetKind;

/** The rail's order, alphabetical by the tab's own label. A category the
 *  registry adds later that this list does not name appends alphabetically
 *  rather than disappearing. */
export const CATEGORY_ORDER: readonly ListingCategory[] = [
  "colour",
  "font",
  "icon",
  "image",
  "video",
  "local",
];

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

export function emptyViews(): Record<ListingCategory, TabView> {
  const views = {} as Record<ListingCategory, TabView>;
  for (const category of CATEGORY_ORDER) views[category] = EMPTY_VIEW;
  return views;
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
