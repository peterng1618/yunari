import {
  type CatalogueEntry,
  type CatalogueIndex,
  type CatalogueItemFile,
  DASHBOARD_THEME_KIND,
  type FabricThemeEnvelope,
  type FacetRecord,
  listingMemberRecords,
  type MemberRecord,
  type PluginMemberContributions,
} from "@yunari/renderer-core";
import type { CollectionPackage } from "@yunari/theme-package";
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
 * skipped by the caller rather than emitted under a fabricated name. `members`
 * is derived from the same stored metadata, and a collection carries its
 * included ids in `includes` with no members of its own.
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
    sha256: version.sha256,
    bytes: version.bytes,
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
      members: membersOf(item, version, envelope),
      ...(remixOf === undefined ? {} : { remixOf }),
    };
  }

  if (item.kind === "collection") {
    const metadata = readJson<Partial<CollectionPackage>>(
      version.metadata_json,
    );
    if (metadata.name === undefined) return undefined;
    return {
      ...shared,
      name: metadata.name,
      members: [],
      includes: (metadata.includes ?? []).map((entry) => entry.id),
    };
  }

  const name = metadataName(version.metadata_json);
  if (name === undefined) return undefined;
  return { ...shared, name, members: membersOf(item, version) };
}

/**
 * The browseable entries the stored metadata already carries, through the one
 * derivation `renderer-core` owns: the same call the editor's local half makes,
 * so a member's id and name are the catalogue's and the installed copy's
 * alike. A collection never reaches here — `entryOf` answers it before this
 * point — and the derivation answers no members for it anyway.
 */
function membersOf(
  item: ItemRow,
  version: VersionRow,
  envelope?: FabricThemeEnvelope,
): readonly MemberRecord[] {
  if (item.kind === DASHBOARD_THEME_KIND) {
    const parsed =
      envelope ?? readJson<FabricThemeEnvelope>(version.envelope_json);
    return listingMemberRecords(DASHBOARD_THEME_KIND, {
      theme: { id: parsed.id, name: item.name },
    });
  }

  const metadata = readJson<Readonly<Record<string, unknown>>>(
    version.metadata_json,
  );
  if (item.kind === "widget-pack")
    return listingMemberRecords(item.kind, { named: metadata["units"] });
  if (item.kind === "path-preset-pack")
    return listingMemberRecords(item.kind, { named: metadata["presets"] });
  if (item.kind === "editor-theme")
    return listingMemberRecords(item.kind, {
      editorThemeName: metadata["name"],
    });
  if (item.kind === "plugin")
    return listingMemberRecords(item.kind, {
      contributions: pluginContributions(metadata),
    });
  return [];
}

/** The stored manifest's contributions, which were validated when the version
 *  was finalized: the row is this store's own, so it is read rather than
 *  re-parsed. A metadata row a newer finalize wrote carries more than these
 *  four groups, which `pluginMemberRecords` ignores. */
function pluginContributions(
  metadata: Readonly<Record<string, unknown>>,
): PluginMemberContributions {
  const manifest = metadata["manifest"];
  const contributes = isRecord(manifest) ? manifest["contributes"] : undefined;
  return isRecord(contributes)
    ? (contributes as PluginMemberContributions)
    : {};
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
