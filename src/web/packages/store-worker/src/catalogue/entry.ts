import {
  type CatalogueEntry,
  type CatalogueIndex,
  type CatalogueItemFile,
  DASHBOARD_THEME_KIND,
  type FabricThemeEnvelope,
  type FacetRecord,
} from "@yunari/renderer-core";
import type { ItemRow, VersionRow } from "../db/types.js";

/**
 * One stored row pair as the wire entry the editor's parser accepts, or
 * `undefined` for a row whose stored metadata cannot name it.
 *
 * `packageUrl` is the absolute Worker URL; `thumbnailUrl` is the stored path
 * (`catalogue/<id>/thumbnail.png`), which the client joins with the origin — the
 * thumbnail stays repo-style, so no absolute thumbnail URL is stored.
 * `remixOf` comes from the stored envelope, because `item.remix_of_id` is only
 * the queryable id and the credit is the full `{ catalogueId, name, version }`.
 * A non-theme kind takes its name from `metadata_json`; an unreadable one is
 * skipped by the caller rather than emitted under a fabricated name.
 */
export function entryOf(
  item: ItemRow,
  version: VersionRow,
  favorites: number,
  packageUrl: string,
  thumbnailUrl: string,
): CatalogueEntry | undefined {
  const facets = readJson<FacetRecord>(version.facets_json);
  const shared = {
    id: item.id,
    kind: item.kind,
    version: version.version,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    downloads: item.downloads,
    favorites,
    packageUrl,
    thumbnail: thumbnailUrl,
    facets,
    ...(item.publisher === "" ? {} : { publisher: item.publisher }),
    ...(version.execution_profile === null
      ? {}
      : { executionProfile: version.execution_profile }),
  };

  if (item.kind === DASHBOARD_THEME_KIND) {
    const envelope = readJson<FabricThemeEnvelope>(version.envelope_json);
    const remixOf = envelope.metadata?.remixOf;
    return {
      ...shared,
      name: item.name,
      ...(remixOf === undefined ? {} : { remixOf }),
    };
  }

  const name = metadataName(version.metadata_json);
  if (name === undefined) return undefined;
  return { ...shared, name };
}

/** The name a pack or plugin's stored metadata carries, or nothing. */
function metadataName(json: string): string | undefined {
  const metadata = readJson<unknown>(json);
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  )
    return undefined;
  const name = (metadata as Readonly<Record<string, unknown>>)["name"];
  return typeof name === "string" && name !== "" ? name : undefined;
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
