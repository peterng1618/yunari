import { readSessionView, writeSessionView } from "../session-view.js";
import type { Facet } from "./facet-row.js";
import { type FacetSelection, STORE_FACET_IDS } from "./local-source.js";
import type { StoreTab } from "./region.js";
import { DEFAULT_SORT, SORT_KEYS } from "./sort-orders.js";

/**
 * What the Themes region keeps for the session: the sort each half was left on
 * and the facets the viewer chose. The region unmounts when another mode is
 * shown, so these cannot live in its own state alone; they are view choices and
 * never enter a theme document.
 */
export const STORE_SORT_KEY = "yunari.editor.store-sort";
export const STORE_FACETS_KEY = "yunari.editor.store-facets";

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
  const parsed = parse(readSessionView(STORE_SORT_KEY));
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
  writeSessionView(STORE_SORT_KEY, JSON.stringify(sort));
}

/** The chosen facets, keeping only these rules: a facet id this build does not
 *  answer with would match nothing, and a non-string value is not one the row
 *  offers. */
export function readStoreFacets(): FacetSelection {
  const chosen: Record<string, readonly string[]> = {};
  const parsed = parse(readSessionView(STORE_FACETS_KEY));
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
  writeSessionView(STORE_FACETS_KEY, JSON.stringify(chosen));
}

/**
 * Drops a restored choice the current listing no longer offers.
 *
 * A value that vanished from the library — the one theme carrying an author
 * was deleted, or another build wrote the choice — would filter every row out,
 * and the popover that no longer draws it offers nothing to un-tick. The
 * listing is therefore the authority, read once it has answered. The same
 * object comes back when nothing was dropped, so a caller can tell without
 * comparing values.
 */
export function pruneStoreFacets(
  chosen: FacetSelection,
  facets: readonly Facet[],
): FacetSelection {
  const offered = new Map(
    facets.map((facet) => [
      facet.id,
      new Set(facet.options.map((option) => option.id)),
    ]),
  );
  let changed = false;
  const next: Record<string, readonly string[]> = {};
  for (const [facetId, values] of Object.entries(chosen)) {
    const options = offered.get(facetId);
    const kept = values.filter((value) => options?.has(value) === true);
    if (kept.length !== values.length) changed = true;
    if (kept.length > 0) next[facetId] = kept;
  }
  return changed ? next : chosen;
}
