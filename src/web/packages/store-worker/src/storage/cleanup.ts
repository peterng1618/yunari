import { UPLOAD_RESERVATION_TTL_MS } from "../db/quota.js";
import type { Env } from "../env.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes pending objects whose reservation is unfinalized and older than the
 * quota's hour, then prunes upload rows older than a week. `now` is the run's
 * instant, so the cutoffs are the ones `pendingBytes` and finalize compare
 * against: a reservation is either expired (only this function may touch it)
 * or live (only finalize may), and no lock column is needed to say which.
 *
 * The `NOT EXISTS` clause is the guard against a future two-statement finalize:
 * Task 6.3 writes the version and releases the reservation in one batch, so it
 * should never fire, but an object a version row names is a live package and
 * must outlive the reservation that uploaded it.
 *
 * The prune follows the deletes, because the key is only known while the row
 * exists. No batch limit: the 60 presigns per author-hour bound arrivals and
 * the 15-minute schedule bounds the backlog.
 */
export async function cleanupPending(
  env: Env,
  now: Date,
): Promise<{ deletedObjects: number; deletedRows: number }> {
  const expiredAt = new Date(
    now.getTime() - UPLOAD_RESERVATION_TTL_MS,
  ).toISOString();
  const expired = await env.DB.prepare(
    `SELECT id, key FROM upload
     WHERE finalized_at IS NULL AND created_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM item_version v WHERE v.package_key = upload.key)`,
  )
    .bind(expiredAt)
    .all<{ id: string; key: string }>();

  // R2 deletes a missing key without error, so an object already gone is not a
  // failure. The count is the rows this run asked R2 to delete.
  const keys = expired.results.map((row) => row.key);
  if (keys.length > 0) await env.BUCKET.delete(keys);

  const weekAgo = new Date(now.getTime() - WEEK_MS).toISOString();
  const pruned = await env.DB.prepare(
    "DELETE FROM upload WHERE created_at <= ?",
  )
    .bind(weekAgo)
    .run();

  return {
    deletedObjects: expired.results.length,
    deletedRows: pruned.meta.changes,
  };
}
