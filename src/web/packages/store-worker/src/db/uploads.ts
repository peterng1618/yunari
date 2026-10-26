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
