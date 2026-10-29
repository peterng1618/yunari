import type {
  CatalogueEntry,
  CatalogueIndex,
  CatalogueItemFile,
  FabricThemeEnvelope,
  FacetRecord,
} from "@yunari/renderer-core";
import type { ItemRow, VersionRow } from "../db/types.js";

/**
 * One stored row pair as the wire entry the editor's parser accepts.
 *
 * `packageUrl` is the absolute Worker URL; `thumbnailUrl` is the stored path
 * (`catalogue/<id>/thumbnail.png`), which the client joins with the origin — the
 * thumbnail stays repo-style, so no absolute thumbnail URL is stored.
 * `remixOf` comes from the stored envelope, because `item.remix_of_id` is only
 * the queryable id and the credit is the full `{ catalogueId, name, version }`.
 */
export function entryOf(
  item: ItemRow,
  version: VersionRow,
  favorites: number,
  packageUrl: string,
  thumbnailUrl: string,
): CatalogueEntry {
  const envelope = readJson<FabricThemeEnvelope>(version.envelope_json);
  const remixOf = envelope.metadata?.remixOf;
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    version: version.version,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    downloads: item.downloads,
    favorites,
    packageUrl,
    thumbnail: thumbnailUrl,
    facets: readJson<FacetRecord>(version.facets_json),
    ...(remixOf === undefined ? {} : { remixOf }),
  };
}

/** The authored header `catalogue/<id>/item.json` carries: no `id` (the
 *  directory names it) and no `facets` (the index's, not the item's). */
export function itemFileOf(entry: CatalogueEntry): CatalogueItemFile {
  const { id: _id, facets: _facets, ...file } = entry;
  return file;
}

/** The listing: the entries as built, stamped with the caller's instant and no
 *  timestamp of its own — which published items make the cut is the query's. */
export function indexDocument(
  entries: readonly CatalogueEntry[],
  generatedAt: string,
): CatalogueIndex {
  return { generatedAt, entries };
}

/** Both JSON columns were written by this Worker from a validated envelope, so
 *  the parse is trusted rather than re-validated. */
function readJson<T>(text: string): T {
  return JSON.parse(text) as T;
}
