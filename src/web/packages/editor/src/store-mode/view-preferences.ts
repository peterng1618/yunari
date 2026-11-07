import { readSessionView, writeSessionView } from "../session-view.js";
import { type FacetSelection, STORE_FACET_IDS } from "./local-source.js";
import type { StoreTab } from "./region.js";
import { DEFAULT_SORT, SORT_KEYS } from "./sort-orders.js";

/**
 * What the Themes region keeps for the session: the sort each half was left on
 * and the facets the viewer chose. The region unmounts when another mode is
 * shown, so these cannot live in its own state alone; they are view choices and
 * never enter a theme document.
 */
const SORT_KEY = "yunari.editor.store-sort";
const FACETS_KEY = "yunari.editor.store-facets";

const TABS: readonly StoreTab[] = ["local", "online"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The stored sort merged over the defaults: **a half keeps its own key or the
 *  default**, because a key that half does not offer would order by nothing. */
export function readStoreSort(): Record<StoreTab, string> {
  const sort: Record<StoreTab, string> = { ...DEFAULT_SORT };
  const parsed = parse(readSessionView(SORT_KEY));
  if (!isRecord(parsed)) return sort;

  for (const tab of TABS) {
    const value = parsed[tab];
    if (
      typeof value === "string" &&
      SORT_KEYS[tab].some((key) => key.id === value)
    ) {
      sort[tab] = value;
    }
  }
  return sort;
}

export function rememberStoreSort(sort: Record<StoreTab, string>): void {
  writeSessionView(SORT_KEY, JSON.stringify(sort));
}

/** The chosen facets, keeping only these rules: a facet id this build does not
 *  answer with would match nothing, and a non-string value is not one the row
 *  offers. */
export function readStoreFacets(): FacetSelection {
  const chosen: Record<string, readonly string[]> = {};
  const parsed = parse(readSessionView(FACETS_KEY));
  if (!isRecord(parsed)) return chosen;

  for (const [facet, values] of Object.entries(parsed)) {
    if (!STORE_FACET_IDS.includes(facet) || !Array.isArray(values)) continue;
    const kept = values.filter(
      (value): value is string => typeof value === "string",
    );
    if (kept.length > 0) chosen[facet] = kept;
  }
  return chosen;
}

export function rememberStoreFacets(chosen: FacetSelection): void {
  writeSessionView(FACETS_KEY, JSON.stringify(chosen));
}
