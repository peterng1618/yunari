import {
  type CatalogueEntry,
  type CatalogueRefusal,
  catalogueIndexUrl,
  catalogueThumbnailUrl,
  DASHBOARD_THEME_KIND,
  parseCatalogueIndex,
} from "@yunari/renderer-core";
import type { ItemSource, StoreItem } from "./local-source.js";

/**
 * The catalogue's listing as an `ItemSource`.
 *
 * **One read, and the browser's cache is the whole mechanism**:
 * no `cache:` option, no `ETag`, no TTL, no retry and no timeout, because the
 * origin's `max-age=60` is the freshness contract and the platform owns the
 * rest. A failed read throws rather than answering an empty catalogue; the
 * region's own rule leaves the listing unset instead of drawing that as "none".
 */
export function onlineThemeSource(
  options: { readonly url?: string; readonly fetch?: typeof fetch } = {},
): ItemSource {
  const url = options.url ?? catalogueIndexUrl();
  let refused: readonly CatalogueRefusal[] = [];

  return {
    kind: DASHBOARD_THEME_KIND,
    async list(): Promise<readonly StoreItem[]> {
      // Cleared before the read, so `refused()` always describes the most recent
      // attempt: a failed read answers none, never the previous read's rows.
      refused = [];
      const response = await (options.fetch ?? fetch)(url);
      if (!response.ok) {
        throw new Error(`The catalogue answered ${response.status}.`);
      }
      const parsed = parseCatalogueIndex(await response.json(), [
        DASHBOARD_THEME_KIND,
      ]);
      refused = parsed.refused;
      return parsed.entries.map(catalogueItemOf);
    },
    refused(): readonly CatalogueRefusal[] {
      return refused;
    },
  };
}

/** One parsed catalogue entry as the item the gallery draws. Shared with the
 *  author's own listing, which is the same entry plus the state it carries. */
export function catalogueItemOf(entry: CatalogueEntry): StoreItem {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    author: entry.facets.author,
    version: entry.version,
    ...(entry.remixOf === undefined ? {} : { remixOf: entry.remixOf }),
    updatedAt: entry.updatedAt,
    thumbnailUrl: catalogueThumbnailUrl(entry.thumbnail),
    // The index carries no artboard paint, and a catalogue item always has a
    // picture, so there is no ground to fill the cell from.
    ground: undefined,
    origin: undefined,
    catalogue: {
      id: entry.id,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      downloads: entry.downloads,
      favorites: entry.favorites,
      packageUrl: entry.packageUrl,
      // What this PC has installed is the library's fact, not the catalogue's.
      installedVersion: undefined,
    },
    facets: entry.facets,
  };
}
