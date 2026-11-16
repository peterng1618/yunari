import {
  type CatalogueEntry,
  type CatalogueRefusal,
  type CatalogueStatus,
  DASHBOARD_THEME_KIND,
  isCatalogueStatus,
  parseCatalogueIndex,
  STORE_ITEM_KINDS,
} from "@yunari/renderer-core";
import type { ItemSource, StoreItem } from "./local-source.js";
import { catalogueItemOf } from "./online-source.js";

/** The route the host proxies the author's own rows through. */
const MINE_PATH = "/api/store/mine";

/** One row's state, as the item carries it. */
interface ItemState {
  readonly status: CatalogueStatus;
  readonly statusReason?: string;
}

/**
 * The author's own listing as an `ItemSource`.
 *
 * The answer is `{ entries }` without the index's own `generatedAt`, and each
 * entry is a catalogue entry **plus the state the public wire shape has no room
 * for**. The entry rules are the public parser's, so the answer is wrapped in
 * the shape it reads rather than parsed a second time here; only the state is
 * this source's own, and a state it cannot name refuses the row.
 *
 * A failed read throws rather than answering an empty listing, as the catalogue
 * source does: `undefined` is what the region draws as "nothing to say", where
 * `[]` would claim the author has submitted nothing.
 */
export function mineThemeSource(
  options: { readonly url?: string; readonly fetch?: typeof fetch } = {},
): ItemSource {
  const url = options.url ?? MINE_PATH;
  let refused: readonly CatalogueRefusal[] = [];

  return {
    kind: DASHBOARD_THEME_KIND,
    async list(): Promise<readonly StoreItem[]> {
      // Cleared before the read, so `refused()` always describes the most recent
      // attempt: a failed read answers none, never the previous read's rows.
      refused = [];
      const response = await (options.fetch ?? fetch)(url);
      if (!response.ok) {
        throw new Error(`The store answered ${response.status}.`);
      }

      const rows = entriesOf(await response.json());
      // The author's listing is every kind they own, so the whole vocabulary
      // is parsed; the parser reports a row of a kind this build does not ship
      // as refused rather than dropping it silently.
      const parsed = parseCatalogueIndex(
        { generatedAt: new Date().toISOString(), entries: rows },
        STORE_ITEM_KINDS,
      );
      const states = statesOf(rows);

      // A parsed row with no readable state is still a row the host sent: it is
      // refused rather than silently dropped, so the surface says it could not
      // read one instead of claiming the author submitted nothing.
      const unreadable = new Map<string, number>();
      const listed: StoreItem[] = [];
      for (const entry of parsed.entries) {
        const state = states.get(entry.id);
        if (state === undefined) {
          unreadable.set(entry.kind, (unreadable.get(entry.kind) ?? 0) + 1);
          continue;
        }
        listed.push(itemOf(entry, state));
      }
      refused = refusalsWith(parsed.refused, unreadable);
      return listed;
    },
    refused(): readonly CatalogueRefusal[] {
      return refused;
    },
  };
}

/** The answer's `entries`, or nothing when the document is not the shape. The
 *  parser reads a missing list as one unreadable document, which is the fact a
 *  body of some other shape is. */
function entriesOf(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  return Object.hasOwn(body, "entries")
    ? (body as Record<string, unknown>).entries
    : undefined;
}

/** The parser's own key for a refusal row, so two rows about one fact merge. */
const refusalKey = (row: CatalogueRefusal): string =>
  JSON.stringify([row.reason, row.kind ?? null]);

/** The parser's rows plus one row per kind whose state could not be read. The
 *  reason is `malformed`: the state is part of the shape this build reads, and
 *  the parser's vocabulary has no third word for it. */
function refusalsWith(
  base: readonly CatalogueRefusal[],
  unreadable: ReadonlyMap<string, number>,
): readonly CatalogueRefusal[] {
  if (unreadable.size === 0) return base;

  const rows = new Map(base.map((row) => [refusalKey(row), row]));
  for (const [kind, count] of unreadable) {
    const row: CatalogueRefusal = { kind, reason: "malformed", count };
    const seen = rows.get(refusalKey(row));
    rows.set(
      refusalKey(row),
      seen === undefined ? row : { ...seen, count: seen.count + count },
    );
  }
  return [...rows.values()];
}

/** Every row's state, by the id the entry declares. A row with no readable id
 *  or state contributes none, and the parsed entry it would have described is
 *  dropped: a state this build cannot name is not one it may show. */
function statesOf(rows: unknown): ReadonlyMap<string, ItemState> {
  const states = new Map<string, ItemState>();
  if (!Array.isArray(rows)) return states;

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const id = record.id;
    const status = record.status;
    if (typeof id !== "string" || !isCatalogueStatus(status)) continue;

    const reason = record.statusReason;
    states.set(
      id,
      typeof reason === "string" && reason.length > 0
        ? { status, statusReason: reason }
        : { status },
    );
  }
  return states;
}

function itemOf(entry: CatalogueEntry, state: ItemState): StoreItem {
  return {
    ...catalogueItemOf(entry),
    status: state.status,
    ...(state.statusReason === undefined
      ? {}
      : { statusReason: state.statusReason }),
  };
}
