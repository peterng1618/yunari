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
