import type { InstalledExtension } from "@yunari/extension-api";
import {
  type CatalogueOrigin,
  defaultFacetsFor,
  type MemberKind,
  type MemberRecord,
  pluginMemberRecords,
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
  list(): Promise<readonly StoreItem[]>;
}

/** One Library page's rule. */
interface PageRule {
  readonly memberKind: MemberKind | "collection" | "listing";
  /** The member kinds a listing must carry at least one of. Empty for a page
   *  whose criterion is the listing's own kind (`collection`) or for a page
   *  that lists whole listings (`listing`). */
  readonly memberKinds: readonly string[];
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
    async list(): Promise<readonly StoreItem[]> {
      const parsed = await readCatalogueListing(options, STORE_ITEM_KINDS);
      return parsed.entries
        .filter((entry) => keeps(rule, entry))
        .map(catalogueItemOf);
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

/** One row of `GET /api/path-presets`. The host keeps one flat preset list and
 *  a preset names no pack, so there is no pack reference to carry. */
export type PathPresetRow = PathPreset;

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

/** One listing row as the item the gallery draws. A non-theme listing has no
 *  document to derive a record from, so it takes the store's own record for the
 *  kind rather than a second spelling here. */
function editorThemeItemOf(row: EditorThemeRow): StoreItem {
  return {
    id: row.id,
    kind: "editor-theme",
    name: row.name,
    members: [{ id: row.id, kind: "editor-theme", name: row.name }],
    author: undefined,
    version: undefined,
    updatedAt: undefined,
    thumbnailUrl: undefined,
    ground: undefined,
    origin: row.origin,
    catalogue: undefined,
    facets: defaultFacetsFor("editor-theme"),
  };
}

function widgetPackItemOf(row: WidgetPackRow): StoreItem {
  return {
    id: row.id,
    kind: "widget-pack",
    name: row.name,
    members: row.units.map((unit) => ({
      id: unit.id,
      kind: "widget",
      name: unit.label,
    })),
    author: undefined,
    version: row.version,
    updatedAt: undefined,
    thumbnailUrl: undefined,
    ground: undefined,
    origin: row.origin,
    catalogue: undefined,
    facets: defaultFacetsFor("widget-pack"),
  };
}

/**
 * One stored shape preset as its own single-member row.
 *
 * **A preset row carries no origin.** `PathPreset` names no pack and the host
 * keeps one flat list, while the register's installed unit for a
 * `path-preset-pack` is the pack. Inventing a pack id here would be a second,
 * wrong owner of that fact, so the Shapes page cannot read installed state from
 * these rows; the limit is recorded for the surface that needs it.
 */
function pathPresetItemOf(row: PathPresetRow): StoreItem {
  return {
    id: row.id,
    kind: "shape",
    name: row.label,
    members: [{ id: row.id, kind: "shape", name: row.label }],
    author: undefined,
    version: undefined,
    updatedAt: undefined,
    thumbnailUrl: undefined,
    ground: undefined,
    origin: undefined,
    catalogue: undefined,
    facets: defaultFacetsFor("shape"),
  };
}

function extensionItemOf(row: ExtensionRow): StoreItem {
  return {
    id: row.key,
    kind: "plugin",
    name: row.name,
    members: pluginMemberRecords(row.contributions),
    author: row.publisher,
    version: row.version,
    updatedAt: undefined,
    thumbnailUrl: undefined,
    ground: undefined,
    origin: row.origin,
    catalogue: undefined,
    facets: defaultFacetsFor("plugin"),
  };
}

/** One reader per page. `collections` reads none: a collection leaves
 *  provenance on the members it installed, never a library row of its own. */
const LIBRARY_READERS: Partial<
  Record<
    LibraryPage,
    (clients: LibraryClients) => Promise<readonly StoreItem[]>
  >
> = {
  "dashboard-themes": async (clients) =>
    (await clients.themes()).map(libraryThemeItemOf),
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
): Promise<readonly StoreItem[]> {
  return (await clients.extensions()).map(extensionItemOf);
}

/**
 * The copies this PC holds for one page.
 *
 * The same page rule filters these rows, so a pack with no units and a plugin
 * with only an asset source are absent from the pages that do not browse them —
 * which is what keeps the local half and the catalogue half agreeing. A failed
 * reader rejects rather than answering an empty listing, as the catalogue half
 * does.
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
    async list(): Promise<readonly StoreItem[]> {
      const items = await reader(clients);
      return items.filter((item) => keeps(rule, item));
    },
  };
}
