import type { InstalledExtension } from "@yunari/extension-api";
import {
  type CatalogueOrigin,
  type CatalogueRefusal,
  defaultFacetsFor,
  type ListingMembers,
  listingMemberRecords,
  type MemberKind,
  type MemberRecord,
  STORE_ITEM_KINDS,
} from "@yunari/renderer-core";
import type { PathPreset, WidgetPackSummary } from "@yunari/theme-package";
import {
  libraryThemeItemOf,
  type StoreItem,
} from "../store-mode/local-source.js";
import {
  type CatalogueReadOptions,
  catalogueItemOf,
  readCatalogueListing,
} from "../store-mode/online-source.js";
import type { ThemeLibraryEntry } from "../theme-library-client.js";

/**
 * One source per Library page, over the two halves the store already reads.
 *
 * A page is one member kind, and the *same* rule selects the catalogue's
 * listings and the copies this PC installed: the page cannot show one half's
 * rows as another half's. A listing answers a page when it carries at least one
 * member of the page's kind, which is what makes one widget pack one entry on
 * the Widgets page rather than one entry per widget.
 *
 * This module is plain functions and row types. The React hooks that read the
 * host (`useExtensions`, the theme-library client, the pack and preset loaders)
 * stay in the region that mounts them; it hands their rows in through
 * {@link LibraryClients}, so nothing here imports a hook.
 */

/** The Library's destinations, in the order its navigation column draws them. */
export type LibraryPage =
  | "dashboard-themes"
  | "app-themes"
  | "widgets"
  | "shapes"
  | "sensor-providers"
  | "asset-sources"
  | "panel-drivers"
  | "collections"
  | "submissions";

/** The Library's state filter: which side of the catalogue a page draws. A
 *  store row is on this PC when it carries an origin, and a library row is
 *  installed by construction. */
export type LibraryState = "all" | "on-this-pc" | "not-installed";

/** One page's read: the rows it can draw, and the catalogue entries the read
 *  could not use. A page that reads this PC's own listings answers no refusals,
 *  because there is no wire entry to refuse. */
export interface LibraryPageRows {
  readonly rows: readonly StoreItem[];
  readonly refused: readonly CatalogueRefusal[];
}

/**
 * What one page reads.
 *
 * `memberKind` names the page's browse unit and is the value a surface reads to
 * word or sub-filter the page. `keeps` is the rule every listing is held to, so
 * the catalogue and the local half cannot drift apart: one definition, two
 * readers.
 */
export interface LibraryPageSource {
  readonly page: LibraryPage;
  /** Listings that carry at least one member of this page's kind. */
  readonly memberKind: MemberKind | "collection" | "listing";
  /** Every member kind the page browses, in its sub-filter's order. A page that
   *  browses one kind answers a one-entry list; `sensor-providers` answers both
   *  of its kinds. The page's sub-filter is built from this, never re-spelled. */
  readonly memberKinds: readonly MemberKind[];
  list(): Promise<LibraryPageRows>;
}

/** One Library page's rule. */
interface PageRule {
  readonly memberKind: MemberKind | "collection" | "listing";
  /** The member kinds a listing must carry at least one of. Empty for a page
   *  whose criterion is the listing's own kind (`collection`) or for a page
   *  that lists whole listings (`listing`). */
  readonly memberKinds: readonly MemberKind[];
}

/**
 * The one page rule. `sensor-providers` names two member kinds because a
 * plugin may contribute either a sensor provider or a data source, and the page
 * browses both under one sub-filter.
 */
const PAGE_RULES: Readonly<Record<LibraryPage, PageRule>> = {
  "dashboard-themes": {
    memberKind: "dashboard-theme",
    memberKinds: ["dashboard-theme"],
  },
  "app-themes": { memberKind: "editor-theme", memberKinds: ["editor-theme"] },
  widgets: { memberKind: "widget", memberKinds: ["widget"] },
  shapes: { memberKind: "shape", memberKinds: ["shape"] },
  "sensor-providers": {
    memberKind: "sensor-provider",
    memberKinds: ["sensor-provider", "data-source"],
  },
  "asset-sources": {
    memberKind: "asset-source",
    memberKinds: ["asset-source"],
  },
  "panel-drivers": {
    memberKind: "panel-driver",
    memberKinds: ["panel-driver"],
  },
  collections: { memberKind: "collection", memberKinds: [] },
  // Never read: both factories refuse `submissions` before a rule is used,
  // because My submissions is the author's own listing (`mineThemeSource`).
  // The entry exists only because this map is total over `LibraryPage`.
  submissions: { memberKind: "listing", memberKinds: [] },
};

/** The few fields the page rule reads, so a catalogue entry and a library item
 *  are held to one rule without either being converted first. */
interface Browseable {
  readonly kind: string;
  readonly members: readonly MemberRecord[];
}

function keeps(rule: PageRule, item: Browseable): boolean {
  if (rule.memberKind === "collection") return item.kind === "collection";
  // A page that lists whole listings rather than one member kind. No page
  // reaches this today: the only `listing` rule is `submissions`, which both
  // factories refuse before filtering. The arm states the rule for a whole-
  // listing page instead of letting the empty `memberKinds` hide it.
  if (rule.memberKind === "listing") return true;
  return rule.memberKinds.some((kind) =>
    item.members.some((member) => member.kind === kind),
  );
}

/**
 * The catalogue's listings for one page.
 *
 * The whole vocabulary is parsed, so a `collection` or a pack is an entry this
 * source can keep; the page rule then selects by member kind. `submissions` is
 * the author's own listing, read through `mineThemeSource`, so it is not a
 * catalogue page and asking for one here is a caller's mistake rather than an
 * empty catalogue.
 */
export function catalogueSourceFor(
  page: LibraryPage,
  options: CatalogueReadOptions = {},
): LibraryPageSource {
  if (page === "submissions") {
    throw new Error(
      'The "submissions" page reads the Mine listing, not the catalogue.',
    );
  }
  const rule = PAGE_RULES[page];

  return {
    page,
    memberKind: rule.memberKind,
    memberKinds: rule.memberKinds,
    async list(): Promise<LibraryPageRows> {
      const parsed = await readCatalogueListing(options, STORE_ITEM_KINDS);
      return {
        rows: parsed.entries
          .filter((entry) => keeps(rule, entry))
          .map(catalogueItemOf),
        refused: parsed.refused,
      };
    },
  };
}

/** One row of `GET /api/editor-themes`: the host's installed editor themes. */
export interface EditorThemeRow {
  readonly id: string;
  readonly name: string;
  readonly origin?: CatalogueOrigin;
}

/** One row of `GET /api/widget-packs`, with the origin the route spreads on.
 *  The summary is `@yunari/theme-package`'s, so its units are not re-spelled. */
export type WidgetPackRow = WidgetPackSummary & {
  readonly origin?: CatalogueOrigin;
};

/** One row of `GET /api/path-presets`, with the origin the route spreads on a
 *  pack's rows. The preset id names its pack, so the route can resolve the
 *  register's installed unit for that pack. */
export type PathPresetRow = PathPreset & {
  readonly origin?: CatalogueOrigin;
};

/** One row of `GET /api/extensions`, with the origin the route spreads on. */
export type ExtensionRow = InstalledExtension & {
  readonly origin?: CatalogueOrigin;
};

/**
 * The host's rows, one plain async reader per listing.
 *
 * They are readers rather than clients so the region that owns the hooks mounts
 * them: a source here calls one reader and never a React hook.
 */
export interface LibraryClients {
  readonly themes: () => Promise<readonly ThemeLibraryEntry[]>;
  readonly editorThemes: () => Promise<readonly EditorThemeRow[]>;
  readonly widgetPacks: () => Promise<readonly WidgetPackRow[]>;
  readonly pathPresets: () => Promise<readonly PathPresetRow[]>;
  readonly extensions: () => Promise<readonly ExtensionRow[]>;
}

/**
 * The catalogue's collection entries, read once for the Library session and
 * handed to a detail surface when it opens. Membership is derived from these
 * collections' `includes`, so every page can answer "Part of" without a second
 * read per card.
 *
 * `entries` is `undefined` until the lazy read answers; `failed` is a read that
 * did not answer, which is not the same fact as an item that belongs to no
 * collection.
 */
export interface CollectionsRead {
  readonly entries: readonly StoreItem[] | undefined;
  readonly failed: boolean;
  readonly loading: boolean;
  readonly retry: () => void;
}

/**
 * This PC's origin register, read once for the Library session when a detail
 * first opens. A collection's install state is counted over these rows, so a
 * collection reached from another page needs them too.
 */
export interface OriginsRead {
  readonly entries: readonly CatalogueOrigin[] | undefined;
  readonly failed: boolean;
  readonly loading: boolean;
  readonly retry: () => void;
}

/** One listing row as the item the gallery draws. A non-theme listing has no
 *  document to derive a record from, so it takes the store's own record for the
 *  kind rather than a second spelling here. */
/** One local row, with whether its member list could be read. The flag comes
 *  off `listingMemberRecords`' own arm and is spent here: `StoreItem.members`
 *  is a plain array, so a consumer comparing two rows never compares a tag. */
interface Listed {
  readonly item: StoreItem;
  readonly unreadable: boolean;
}

function listed(item: StoreItem, members: ListingMembers): Listed {
  return { item, unreadable: members.unreadable };
}

function editorThemeItemOf(row: EditorThemeRow): Listed {
  const members = listingMemberRecords("editor-theme", {
    editorThemeName: row.name,
  });
  return listed(
    {
      id: row.id,
      kind: "editor-theme",
      name: row.name,
      members: [...members],
      author: undefined,
      version: undefined,
      updatedAt: undefined,
      thumbnailUrl: undefined,
      ground: undefined,
      origin: row.origin,
      catalogue: undefined,
      facets: defaultFacetsFor("editor-theme"),
    },
    members,
  );
}

function widgetPackItemOf(row: WidgetPackRow): Listed {
  const members = listingMemberRecords("widget-pack", { named: row.units });
  return listed(
    {
      id: row.id,
      kind: "widget-pack",
      name: row.name,
      members: [...members],
      author: undefined,
      version: row.version,
      updatedAt: undefined,
      thumbnailUrl: undefined,
      ground: undefined,
      origin: row.origin,
      catalogue: undefined,
      facets: defaultFacetsFor("widget-pack"),
    },
    members,
  );
}

/** One stored shape preset as its own single-member row. A pack's preset row
 *  carries that pack's origin from the host; a user preset carries none. */
function pathPresetItemOf(row: PathPresetRow): Listed {
  const members = listingMemberRecords("path-preset-pack", { named: [row] });
  return listed(
    {
      id: row.id,
      kind: "shape",
      name: row.label,
      members: [...members],
      author: undefined,
      version: undefined,
      updatedAt: undefined,
      thumbnailUrl: undefined,
      ground: undefined,
      origin: row.origin,
      catalogue: undefined,
      facets: defaultFacetsFor("shape"),
    },
    members,
  );
}

function extensionItemOf(row: ExtensionRow): Listed {
  const members = listingMemberRecords("plugin", {
    contributions: row.contributions,
  });
  return listed(
    {
      id: row.key,
      kind: "plugin",
      name: row.name,
      members: [...members],
      author: row.publisher,
      version: row.version,
      updatedAt: undefined,
      thumbnailUrl: undefined,
      ground: undefined,
      origin: row.origin,
      catalogue: undefined,
      facets: defaultFacetsFor("plugin"),
    },
    members,
  );
}

/** One reader per page. `collections` reads none: a collection leaves
 *  provenance on the members it installed, never a library row of its own. */
const LIBRARY_READERS: Partial<
  Record<LibraryPage, (clients: LibraryClients) => Promise<readonly Listed[]>>
> = {
  // The dashboard theme names itself as its one member, so the record cannot be
  // unreadable: the listing row already carries both the id and the name.
  "dashboard-themes": async (clients) =>
    (await clients.themes()).map((entry) => ({
      item: libraryThemeItemOf(entry),
      unreadable: false,
    })),
  "app-themes": async (clients) =>
    (await clients.editorThemes()).map(editorThemeItemOf),
  widgets: async (clients) =>
    (await clients.widgetPacks()).map(widgetPackItemOf),
  shapes: async (clients) =>
    (await clients.pathPresets()).map(pathPresetItemOf),
  "sensor-providers": installedExtensions,
  "asset-sources": installedExtensions,
  "panel-drivers": installedExtensions,
  collections: async () => [],
};

/** The three code pages read one listing; the page rule then keeps the members
 *  each browses. */
async function installedExtensions(
  clients: LibraryClients,
): Promise<readonly Listed[]> {
  return (await clients.extensions()).map(extensionItemOf);
}

/**
 * Whether a row's member list could not be read. The refusal arm
 * `listingMemberRecords` answers is spent when the row is built, because
 * `StoreItem.members` is a plain array: a tag travelling on it would be
 * compared by every reader that compares two listings.
 */
function membersUnreadable(row: Listed): boolean {
  return row.unreadable;
}

/**
 * The copies this PC holds for one page.
 *
 * The same page rule filters these rows, so a pack with no units and a plugin
 * with only an asset source are absent from the pages that do not browse them —
 * which is what keeps the local half and the catalogue half agreeing. A failed
 * reader rejects rather than answering an empty listing, as the catalogue half
 * does.
 *
 * **A listing whose members could not be read is refused, not drawn empty**: an
 * empty member list is the fact that a listing carries none, and a host row
 * that named a member the reader could not parse is a different fact the page
 * states like any other refusal.
 */
export function librarySourceFor(
  page: LibraryPage,
  clients: LibraryClients,
): LibraryPageSource {
  const reader = LIBRARY_READERS[page];
  if (reader === undefined) {
    throw new Error(
      `The "${page}" page reads the Mine listing, not the library.`,
    );
  }
  const rule = PAGE_RULES[page];

  return {
    page,
    memberKind: rule.memberKind,
    memberKinds: rule.memberKinds,
    async list(): Promise<LibraryPageRows> {
      const listedRows = await reader(clients);
      const readable: StoreItem[] = [];
      const refusedByKind = new Map<string, number>();
      for (const row of listedRows) {
        if (membersUnreadable(row)) {
          const kind = row.item.kind;
          refusedByKind.set(kind, (refusedByKind.get(kind) ?? 0) + 1);
        } else {
          readable.push(row.item);
        }
      }
      const refused: CatalogueRefusal[] = [...refusedByKind].map(
        ([kind, count]) => ({ kind, reason: "malformed", count }),
      );
      return {
        rows: readable.filter((item) => keeps(rule, item)),
        refused,
      };
    },
  };
}
