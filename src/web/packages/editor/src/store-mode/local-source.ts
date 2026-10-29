import {
  type CatalogueRefusal,
  type CatalogueStatus,
  DASHBOARD_THEME_KIND,
  type FacetRecord,
  type Orientation,
  type ThemeRemix,
} from "@yunari/renderer-core";
import type {
  ThemeLibraryClient,
  ThemeOrigin,
} from "../theme-library-client.js";
import { THEME_TAG_SEED } from "../theme-tag-seed.js";

/**
 * The local half's items, behind the one hop that makes a second kind cheap.
 *
 * The gallery reads `ItemSource` and never `ThemeLibraryClient` or the host's
 * store, so a second kind is a second source rather than a rewrite of this tab.
 * `ThemeLibraryClient`
 * gains nothing here: the source wraps it.
 */

/** One item the gallery draws, whichever kind it is.
 *
 * `kind` is the **wire** value (`"dashboard-theme"`), never a word a person
 * reads: what a kind is called is `uiCopy`'s, and a client older than the kind
 * prints the identifier rather than inventing a name for it.
 *
 * `ground` is the theme's own artboard paint — a CSS paint string, a colour or a
 * `linear-gradient(...)` — and it arrives on the listing, derived by the host
 * from the envelope it already parsed. `FacetRecord` carries no paint, and the
 * cell draws the ground in place of a picture a theme does not have, so it is
 * read here rather than resolved: a reader that opened every listed theme to
 * find one paint string would be a second pass over the library.
 */
export interface StoreItem {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly author: string | undefined;
  /** The document's own version, or `undefined` when it declares none. The
   *  caption line prints it beside the date (`1.4.0 · 2026-10-14`), and it
   *  arrives on the listing for the same reason `ground` does: one pass. */
  readonly version: string | undefined;
  /** The catalogue item this document was remixed from, or `undefined` for a
   *  document that credits none. Optional like the host's own entry: a theme
   *  with no credit has no key at all. */
  readonly remixOf?: ThemeRemix;
  readonly updatedAt: string | undefined;
  readonly thumbnailUrl: string | undefined;
  readonly ground: string | undefined;
  /** Where this copy came from, or `undefined` for a theme the host holds no
   *  record of — one the author made here. A required key whose value may be
   *  absent, as `author` and `version` are: a cell reads the field rather than
   *  asking whether the key exists, and `exactOptionalPropertyTypes` forbids the
   *  optional spelling this would otherwise take. */
  readonly origin: ThemeOrigin | undefined;
  /** The catalogue's own facts about this item, or `undefined` for an item the
   *  library holds and the catalogue does not. `installedVersion` is the one
   *  field a source cannot fill: it is a fact about the library, so the source
   *  leaves it absent and the join sets it. */
  readonly catalogue: CatalogueFacts | undefined;
  readonly facets: FacetRecord;
  /** The item's own state, where the source is the author's own listing; the
   *  public catalogue and the library hold none, so both keys are absent rather
   *  than undefined (`exactOptionalPropertyTypes`). The Mine surface reads it as
   *  display data, never as a filter. */
  readonly status?: CatalogueStatus;
  readonly statusReason?: string;
}

/**
 * What the catalogue says about an item, in the shape a cell reads it.
 *
 * It is the wire entry **minus the two `StoreItem` already carries** — `facets`
 * and `thumbnail`, which arrive as `item.facets` and `item.thumbnailUrl` —
 * **plus `installedVersion`**, which is a fact about this PC's library rather
 * than the catalogue. The wire shape stays in `renderer-core`.
 */
export interface CatalogueFacts {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly downloads: number;
  readonly favorites: number;
  readonly packageUrl: string;
  readonly installedVersion: string | undefined;
}

/** One kind's list, as the gallery reads it. `kind` is on the source rather than
 *  on a request, so a surface cannot ask one source for another kind's items. */
export interface ItemSource {
  readonly kind: string;
  list(): Promise<readonly StoreItem[]>;
  /** What the last `list()` skipped, so a caller reads one shape whether it
   *  holds the library or the catalogue. The library has no wire entries to
   *  refuse and answers none. */
  refused(): readonly CatalogueRefusal[];
}

/**
 * The four things a cell can do, and the one callback they travel through.
 *
 * One callback rather than four props, and rather than an `onOpen`: the cell
 * draws four actions, so a callback per action would be four props a caller can
 * half-wire, and an `onOpen` alone cannot express the other three. The plan's
 * Step 3 requires all four, and the drawing's facts band carries all four.
 */
export type CellAction = "open" | "assign" | "export" | "delete";

/** What the facets are narrowed by: one facet id, and the values chosen in it.
 *  A facet that is absent, or present with nothing chosen, is "any". */
export type FacetSelection = Readonly<Record<string, readonly string[]>>;

/**
 * The host's own library as an `ItemSource`.
 *
 * **One listing, and no second read.** Everything a cell needs — the facets, the
 * author, the picture's address and the ground — is on the entry the host
 * derived from the document it already parsed, so `list()` maps what it is
 * handed and opens nothing.
 */
export function localThemeSource(client: ThemeLibraryClient): ItemSource {
  return {
    kind: DASHBOARD_THEME_KIND,
    async list(): Promise<readonly StoreItem[]> {
      const entries = await client.list();
      return entries.map((entry) => ({
        id: entry.id,
        kind: DASHBOARD_THEME_KIND,
        name: entry.name,
        author: entry.author,
        version: entry.version,
        ...(entry.remixOf === undefined ? {} : { remixOf: entry.remixOf }),
        updatedAt: entry.updatedAt,
        thumbnailUrl: entry.thumbnailUrl,
        ground: entry.ground,
        origin: entry.origin,
        catalogue: undefined,
        facets: entry.facets,
      }));
    },
    refused(): readonly CatalogueRefusal[] {
      return [];
    },
  };
}

/**
 * One facet's own rule, handed only the values chosen in that facet: the rules
 * differ per facet, and the difference is one deliberate exception rather than
 * a detail of the loop.
 */
type FacetMatcher = (item: StoreItem, chosen: readonly string[]) => boolean;

/**
 * Shape's three groups, in the order the drawing's Shape popover offers them.
 * Each is read off the item's own record, so a group's reading and the value a
 * person chooses come from one vocabulary.
 */
const SHAPE_GROUPS: readonly ((item: StoreItem) => string)[] = [
  (item) => item.facets.orientation,
  (item) => item.facets.aspect,
  (item) => `${item.facets.width}x${item.facets.height}`,
];

/** The orientation group's whole vocabulary, typed from the record's own union
 *  so the two cannot be spelled differently. */
const SHAPE_ORIENTATIONS: readonly Orientation[] = [
  "landscape",
  "portrait",
  "square",
];

/** A bucket's form — `16:9`, `1:1`, `19.5:9` — and the one bucket that is a word
 *  rather than a ratio. Recognised by form rather than by a second copy of the
 *  record's bucket list, which would be a list to keep in step for no gain. */
const SHAPE_RATIO = /^\d+(?:\.\d+)?:\d+$/;

/** An exact size's form: `1920x1080`. */
const SHAPE_SIZE = /^\d+x\d+$/;

/**
 * Which of the three groups a chosen shape value names, or `undefined` for a
 * value that names none — and a value naming no group can be satisfied by no
 * theme, so it is not a value that simply fails to match.
 */
function shapeGroupOf(value: string): number | undefined {
  if (SHAPE_ORIENTATIONS.some((orientation) => orientation === value)) return 0;
  if (value === "other" || SHAPE_RATIO.test(value)) return 1;
  if (SHAPE_SIZE.test(value)) return 2;
  return undefined;
}

/**
 * Shape is the one facet with groups inside it: **every group the selection
 * names has to hold, and within one group the values are alternatives** — the
 * ordinary rule one level down. So `landscape 16:9` is one shape, not three
 * alternatives, and a portrait board cannot answer a landscape selection just
 * because the bucket it reads (`16:9`) is also the one chosen.
 */
function matchesShape(item: StoreItem, chosen: readonly string[]): boolean {
  const groups: string[][] = [[], [], []];
  for (const value of chosen) {
    const group = shapeGroupOf(value);
    if (group === undefined) return false;
    groups[group]?.push(value);
  }

  return groups.every((values, index) => {
    if (values.length === 0) return true;
    const reading = SHAPE_GROUPS[index]?.(item);
    return reading !== undefined && values.includes(reading);
  });
}

/**
 * One rule per facet, keyed by the facet ids the region's row draws.
 *
 * **Within a facet the values are OR, across facets they are AND — except
 * Sensors and Shape, where they are AND**. Two facets ask a question only *all*
 * of a selection can answer: a theme must read every sensor asked for, so "CPU
 * and GPU" cannot answer with a CPU-only theme, and it must have every shape
 * property asked for, which `matchesShape` holds a level down.
 */
const FACET_MATCHERS: Readonly<Record<string, FacetMatcher>> = {
  author: (item, chosen) => chosen.some((value) => value === item.author),
  // **An unclassified theme carries no colour-mode value.** `unclassified` is
  // the absence of an answer rather than one a person can ask for — a mid-grey
  // ground, or a picture behind the board — so it is reachable under "any" and
  // under no other value, including a selection naming it. Reading it as a
  // value would let the facet hide a theme from someone who never asked it to.
  "colour-mode": (item, chosen) =>
    item.facets.colourMode !== "unclassified" &&
    chosen.includes(item.facets.colourMode),
  sensors: (item, chosen) =>
    chosen.every((value) =>
      item.facets.sensors.some((sensor) => sensor.key === value),
    ),
  shape: matchesShape,
  // The ordinary reading, like author and colour mode: two tags are alternatives
  // a theme answers with either one, where the same two on Sensors ask for both.
  style: (item, chosen) =>
    chosen.some((value) => item.facets.tags.includes(value)),
};

/**
 * Whether an item survives what is chosen, and it is pure so a page can narrow a
 * list it already holds without asking a source again.
 *
 * A facet with nothing chosen is "any" and matches everything, which is what
 * keeps a theme that binds no sensor reachable: nothing is asked of a facet
 * nobody chose in, so a theme with an empty answer is excluded by a sensor
 * selection and kept by no selection at all — never by a facet that silently
 * treats it as matching.
 *
 * A facet id this build does not know has no rule, so a selection in one matches
 * nothing: a filter nothing can answer is not a filter that matches everything.
 */
export function matchesFacets(
  item: StoreItem,
  chosen: FacetSelection,
): boolean {
  for (const [facet, values] of Object.entries(chosen)) {
    if (values.length === 0) continue;
    // `Object.hasOwn`, not a bare read of the table: a facet id naming a
    // prototype member (`constructor`, `valueOf`, `__proto__`) would otherwise
    // be answered with that member rather than with no rule — one that matches
    // everything, one that throws, one that is not a function at all.
    const matcher = Object.hasOwn(FACET_MATCHERS, facet)
      ? FACET_MATCHERS[facet]
      : undefined;
    if (matcher === undefined || !matcher(item, values)) return false;
  }
  return true;
}

/**
 * Whether an item answers a query: what a person typed is matched against the
 * two words the cell already prints — the name and the author — case-folded,
 * with the query's own ends trimmed. An empty query is every item, which is what
 * an untouched well means.
 *
 * **The author is read off the item and not off its record.** The two carry the
 * same string today, and the facet's own rule reads `item.author`; a query that
 * read the other one would be a second answer to one question.
 *
 * It lives beside `matchesFacets` rather than in the region, because it is the
 * sixth filter: the surface applies the two together and owns neither, and the
 * brief's "never a second predicate written here" is that same rule.
 */
export function matchesQuery(item: StoreItem, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  return (
    item.name.toLowerCase().includes(wanted) ||
    (item.author ?? "").toLowerCase().includes(wanted)
  );
}

/**
 * The style tags the vocabulary holds for one item: the shipped seed, plus every
 * tag the listing's **other** themes carry.
 *
 * **This is what "proposed" is read against, and the obvious rule cannot be
 * used.** The Style facet's options are read off this same listing, and the item
 * is one of its entries, so its own tag is always among them — nothing would
 * ever read as proposed. A tag is settled when the vocabulary holds it, from the
 * seed or from another theme's use, and proposed only when this theme is its
 * first use, which is the surface's own phrase.
 */
export function settledTags(
  items: readonly StoreItem[],
  item: StoreItem,
): readonly string[] {
  const settled = new Set<string>(THEME_TAG_SEED);
  for (const other of items) {
    if (other.id === item.id) continue;
    for (const tag of other.facets.tags) settled.add(tag);
  }
  return [...settled];
}
