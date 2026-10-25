import type { VersionRow } from "./types.js";

/**
 * Writes a version row and releases its reservation in one D1 batch, which D1
 * runs as one transaction. Two statements would leave a window in which the
 * version names a key whose upload row is unfinalized: cleanup would delete
 * that object an hour later, leaving a published package that 404s. Answers
 * whether this call inserted the row (a lost `OR IGNORE` race answers false).
 */
export async function finalizeStoredVersion(
  db: D1Database,
  row: VersionRow,
  now: string,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO item_version (item_id, version, envelope_json,
           facets_json, package_key, thumbnail_key, bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.item_id,
        row.version,
        row.envelope_json,
        row.facets_json,
        row.package_key,
        row.thumbnail_key,
        row.bytes,
        row.sha256,
        row.created_at,
      ),
    releaseStatement(db, row.item_id, row.version, now),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

/**
 * Releases the reservation whose pending key a stored version names.
 *
 * Selecting by `package_key` rather than by a row id makes a lost `OR IGNORE`
 * race release the winner's row, not the one this request picked. The size is
 * read from that same version row, never from the caller: a losing finalize
 * with different bytes runs its batch before the 409 comparison, so a
 * caller-supplied size could write one request's figure onto another's row.
 * Any other reservation for the same version stays unfinalized on purpose:
 * cleanup deletes its object after the hour and `pendingBytes` counts it until
 * then, so marking it finalized would make the object permanent and uncounted.
 */
export async function releaseReservedUpload(
  db: D1Database,
  itemId: string,
  version: string,
  now: string,
): Promise<void> {
  await releaseStatement(db, itemId, version, now).run();
}

function releaseStatement(
  db: D1Database,
  itemId: string,
  version: string,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE upload
       SET finalized_at = ?,
           bytes = (SELECT v.bytes FROM item_version v
                    WHERE v.item_id = ? AND v.version = ?
                      AND v.package_key = upload.key)
       WHERE finalized_at IS NULL
         AND key IN (
           SELECT package_key FROM item_version
           WHERE item_id = ? AND version = ?)`,
    )
    .bind(now, itemId, version, itemId, version);
}
