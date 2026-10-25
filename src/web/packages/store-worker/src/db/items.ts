import type { CatalogueStatus } from "@yunari/renderer-core";
import type { ItemRow, VersionRow } from "./types.js";

/** The pending-upload record finalize reads its envelope and version from. */
export interface PresignRow {
  readonly item_id: string;
  readonly version: string;
  readonly envelope_json: string;
}

/** One stored item and the version a listing shows it at. */
export interface Listing {
  readonly item: ItemRow;
  readonly version: VersionRow;
}

/**
 * Every published item with its latest version, for the index.
 *
 * "Latest" is the greatest `created_at` — the finalize instant — with `rowid` as
 * the tiebreak, so it follows the ladder rather than the version text.
 */
export async function publishedListings(
  db: D1Database,
): Promise<readonly Listing[]> {
  const items = await db
    .prepare(
      "SELECT * FROM item WHERE status = 'published' ORDER BY updated_at DESC, id",
    )
    .all<ItemRow>();
  const versions = await db
    .prepare(
      `SELECT v.* FROM item_version v
       JOIN item i ON i.id = v.item_id
       WHERE i.status = 'published'
         AND v.rowid = (
           SELECT v2.rowid FROM item_version v2
           WHERE v2.item_id = v.item_id
           ORDER BY v2.created_at DESC, v2.rowid DESC
           LIMIT 1
         )`,
    )
    .all<VersionRow>();
  const latest = new Map(versions.results.map((row) => [row.item_id, row]));
  return items.results.flatMap((item) => {
    const version = latest.get(item.id);
    return version === undefined ? [] : [{ item, version }];
  });
}

/**
 * The columns the joined listing queries select. `item` and `item_version`
 * share `created_at` (and, on the join, `id`), so each side is aliased by the
 * name of the table it came from. The left join makes the version nullable.
 */
interface JoinedRow {
  readonly item_id: string;
  readonly kind: string;
  readonly author_user_id: string;
  readonly name: string;
  readonly status: CatalogueStatus;
  readonly status_reason: string | null;
  readonly item_created_at: string;
  readonly item_updated_at: string;
  readonly published_at: string | null;
  readonly unpublished_at: string | null;
  readonly removed_at: string | null;
  readonly downloads: number;
  readonly remix_of_id: string | null;
  readonly version: string | null;
  readonly envelope_json: string | null;
  readonly facets_json: string | null;
  readonly package_key: string | null;
  readonly thumbnail_key: string | null;
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly version_created_at: string | null;
}

/** The latest version's row, or `null` when a left join found none. */
function versionOfRow(row: JoinedRow): VersionRow | null {
  if (
    row.version === null ||
    row.envelope_json === null ||
    row.facets_json === null ||
    row.package_key === null ||
    row.thumbnail_key === null ||
    row.bytes === null ||
    row.sha256 === null ||
    row.version_created_at === null
  )
    return null;
  return {
    item_id: row.item_id,
    version: row.version,
    envelope_json: row.envelope_json,
    facets_json: row.facets_json,
    package_key: row.package_key,
    thumbnail_key: row.thumbnail_key,
    bytes: row.bytes,
    sha256: row.sha256,
    created_at: row.version_created_at,
  };
}

function itemOf(row: JoinedRow): ItemRow {
  return {
    id: row.item_id,
    kind: row.kind,
    author_user_id: row.author_user_id,
    name: row.name,
    status: row.status,
    status_reason: row.status_reason,
    created_at: row.item_created_at,
    updated_at: row.item_updated_at,
    published_at: row.published_at,
    unpublished_at: row.unpublished_at,
    removed_at: row.removed_at,
    downloads: row.downloads,
    remix_of_id: row.remix_of_id,
  };
}

/** An inner-joined row that must carry a version; a null is a broken query. */
function listingOf(row: JoinedRow): Listing {
  const version = versionOfRow(row);
  if (version === null)
    throw new Error("A joined listing row carries no version.");
  return { item: itemOf(row), version };
}

/** One author's listing row: the item, its latest version and its count. */
export interface AuthorListing extends Listing {
  readonly favorites: number;
}

/**
 * Every one of an author's versioned items in one statement, newest first.
 *
 * The latest version is the same selection `publishedListings` makes — greatest
 * `created_at`, `rowid` the tiebreak — and the favourite count is correlated
 * rather than a second round trip, so the listing costs one statement whatever
 * its length.
 */
export async function authorListings(
  db: D1Database,
  userId: string,
): Promise<readonly AuthorListing[]> {
  const rows = await db
    .prepare(
      `SELECT
         i.id AS item_id, i.kind, i.author_user_id, i.name, i.status,
         i.status_reason, i.created_at AS item_created_at,
         i.updated_at AS item_updated_at, i.published_at, i.unpublished_at,
         i.removed_at, i.downloads, i.remix_of_id,
         v.version, v.envelope_json, v.facets_json, v.package_key,
         v.thumbnail_key, v.bytes, v.sha256,
         v.created_at AS version_created_at,
         (SELECT COUNT(*) FROM favorite f WHERE f.item_id = i.id) AS favorites
       FROM item i
       JOIN item_version v ON v.item_id = i.id
         AND v.rowid = (
           SELECT v2.rowid FROM item_version v2
           WHERE v2.item_id = i.id
           ORDER BY v2.created_at DESC, v2.rowid DESC
           LIMIT 1
         )
       WHERE i.author_user_id = ?
         AND EXISTS (SELECT 1 FROM item_version ev WHERE ev.item_id = i.id)
       ORDER BY i.updated_at DESC, i.id ASC`,
    )
    .bind(userId)
    .all<JoinedRow & { readonly favorites: number }>();
  return rows.results.map((row) => ({
    ...listingOf(row),
    favorites: row.favorites,
  }));
}

/** One pending item, its latest version (if any) and its author's email. */
export interface QueueListing {
  readonly item: ItemRow;
  readonly version: VersionRow | null;
  readonly authorEmail: string | null;
}

/**
 * The owner's pending queue in one statement, oldest first. The version is a
 * left join because a pending item may predate its first finalize, and the
 * email is the same join `queueEntryOf` used to make per item. The table name
 * stays quoted: `user` is a keyword in SQLite.
 */
export async function queueListings(
  db: D1Database,
): Promise<readonly QueueListing[]> {
  const rows = await db
    .prepare(
      `SELECT
         i.id AS item_id, i.kind, i.author_user_id, i.name, i.status,
         i.status_reason, i.created_at AS item_created_at,
         i.updated_at AS item_updated_at, i.published_at, i.unpublished_at,
         i.removed_at, i.downloads, i.remix_of_id,
         v.version, v.envelope_json, v.facets_json, v.package_key,
         v.thumbnail_key, v.bytes, v.sha256,
         v.created_at AS version_created_at,
         u.email AS author_email
       FROM item i
       LEFT JOIN item_version v ON v.item_id = i.id
         AND v.rowid = (
           SELECT v2.rowid FROM item_version v2
           WHERE v2.item_id = i.id
           ORDER BY v2.created_at DESC, v2.rowid DESC
           LIMIT 1
         )
       LEFT JOIN "user" u ON u.id = i.author_user_id
       WHERE i.status = 'pending'
       ORDER BY i.created_at, i.id`,
    )
    .all<JoinedRow & { readonly author_email: string | null }>();
  return rows.results.map((row) => ({
    item: itemOf(row),
    version: versionOfRow(row),
    authorEmail: row.author_email,
  }));
}

export async function itemById(
  db: D1Database,
  itemId: string,
): Promise<ItemRow | undefined> {
  return (
    (await db
      .prepare("SELECT * FROM item WHERE id = ?")
      .bind(itemId)
      .first<ItemRow>()) ?? undefined
  );
}

/** Any state's newest version; the caller decides whether it may be shown. */
export async function latestVersion(
  db: D1Database,
  itemId: string,
): Promise<VersionRow | undefined> {
  return (
    (await db
      .prepare(
        `SELECT * FROM item_version WHERE item_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .bind(itemId)
      .first<VersionRow>()) ?? undefined
  );
}

export async function versionOf(
  db: D1Database,
  itemId: string,
  version: string,
): Promise<VersionRow | undefined> {
  return (
    (await db
      .prepare("SELECT * FROM item_version WHERE item_id = ? AND version = ?")
      .bind(itemId, version)
      .first<VersionRow>()) ?? undefined
  );
}

/** The most recent signed upload for one author's item version, if any. */
export async function presignEventOf(
  db: D1Database,
  userId: string,
  itemId: string,
  version: string,
): Promise<PresignRow | undefined> {
  return (
    (await db
      .prepare(
        `SELECT item_id, version, envelope_json FROM presign_event
         WHERE user_id = ? AND item_id = ? AND version = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(userId, itemId, version)
      .first<PresignRow>()) ?? undefined
  );
}

/**
 * Finalize's status write. `published_at` is the last transition *into*
 * `published`, so a new version on a still-published item keeps it; the
 * pre-update `status` is what makes that distinction. A rejection reason never
 * outlives `rejected`. Counters, favourites and older versions are untouched.
 *
 * `removed` is the owner's verdict and is refused rather than overwritten: a
 * takedown that lands between the caller's read and this write would otherwise
 * become public again. The answer says whether the write landed.
 */
export async function markFinalized(
  db: D1Database,
  itemId: string,
  status: CatalogueStatus,
  now: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE item SET status = ?, updated_at = ?,
         published_at = CASE
           WHEN ? = 'published' AND status <> 'published' THEN ?
           ELSE published_at
         END,
         status_reason = CASE WHEN status = 'rejected' THEN NULL
           ELSE status_reason END
       WHERE id = ? AND status <> 'removed'`,
    )
    .bind(status, now, status, now, itemId)
    .run();
  return result.meta.changes > 0;
}

/**
 * The one guarded status write every owner and author transition reuses.
 *
 * `from` is a precondition, not advice: two actors racing on one item leave the
 * loser with `false` instead of a state neither asked for. A null `reason`
 * clears the stored sentence, so a rejection cannot outlive a later publish.
 * Each timestamp only moves on the transition it names.
 */
export async function setStatus(
  db: D1Database,
  itemId: string,
  from: readonly string[],
  to: string,
  at: string,
  reason: string | null = null,
): Promise<boolean> {
  const placeholders = from.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `UPDATE item SET status = ?, updated_at = ?,
         published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END,
         unpublished_at = CASE WHEN ? = 'unpublished' THEN ? ELSE unpublished_at END,
         removed_at = CASE WHEN ? = 'removed' THEN ? ELSE removed_at END,
         status_reason = ?
       WHERE id = ? AND status IN (${placeholders})`,
    )
    .bind(to, at, to, at, to, at, to, at, reason, itemId, ...from)
    .run();
  return result.meta.changes > 0;
}

/**
 * The one counter the store owns. The status predicate is repeated here rather
 * than trusted from the caller's read: an unpublish between the read and this
 * write must not count, and the answer says whether it did.
 */
export async function bumpDownloads(
  db: D1Database,
  itemId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE item SET downloads = downloads + 1 WHERE id = ? AND status = 'published'",
    )
    .bind(itemId)
    .run();
  return result.meta.changes > 0;
}
