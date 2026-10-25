import type { UploadRow } from "./types.js";

/**
 * Every reservation for one item version, newest first.
 *
 * More than one is legitimate: a second version request after a failed PUT
 * mints another row, and the older one keeps its reservation until it expires.
 */
export async function uploadsForVersion(
  db: D1Database,
  userId: string,
  itemId: string,
  version: string,
): Promise<readonly UploadRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM upload
       WHERE user_id = ? AND item_id = ? AND version = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .bind(userId, itemId, version)
    .all<UploadRow>();
  return rows.results;
}

/**
 * Releases one reservation with the size the package actually stored. The
 * `finalized_at IS NULL` predicate makes a replay a no-op; answers whether this
 * call wrote, which the route does not need but a caller that must know can use.
 */
export async function markUploadFinalized(
  db: D1Database,
  uploadId: string,
  bytes: number,
  now: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE upload SET finalized_at = ?, bytes = ? WHERE id = ? AND finalized_at IS NULL",
    )
    .bind(now, bytes, uploadId)
    .run();
  return result.meta.changes > 0;
}
