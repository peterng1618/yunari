import {
  type CatalogueEntry,
  type CatalogueRefusal,
  catalogueIndexUrl,
  catalogueThumbnailUrl,
  parseCatalogueIndex,
} from "@yunari/renderer-core";
import type { StoreItem } from "./local-source.js";

/** Where the index is read from, and with what transport. */
export interface CatalogueReadOptions {
  readonly url?: string;
  readonly fetch?: typeof fetch;
}

/**
 * The catalogue's index, read once.
 *
 * **The browser's cache is the whole freshness mechanism**: no `cache:` option,
 * no `ETag`, no TTL, no retry and no timeout, because the origin's `max-age=60`
 * is the contract and the platform owns the rest. A failed read throws rather
 * than answering an empty catalogue, so a caller that leaves its listing unset
 * does not draw that failure as "none".
 *
 * Shared by every source over the index, so the read and the parser's known
 * kinds are stated once: the dashboard theme's source parses its own kind, and
 * the Library's pages parse the whole vocabulary and filter the entries.
 */
export async function readCatalogueListing(
  options: CatalogueReadOptions,
  knownKinds: readonly string[],
): Promise<{
  readonly entries: readonly CatalogueEntry[];
  readonly refused: readonly CatalogueRefusal[];
}> {
  const url = options.url ?? catalogueIndexUrl();
  const response = await (options.fetch ?? fetch)(url);
  if (!response.ok) {
    throw new Error(`The catalogue answered ${response.status}.`);
  }
  return parseCatalogueIndex(await response.json(), knownKinds);
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
    members: entry.members,
    // The wire carries each include's optional default, so this row and the
    // install sheet's plan read the same fact about what may be skipped.
    ...(entry.includes === undefined ? {} : { includes: entry.includes }),
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
      ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 }),
      ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }),
      ...(entry.publisher === undefined ? {} : { publisher: entry.publisher }),
    },
    facets: entry.facets,
  };
}
