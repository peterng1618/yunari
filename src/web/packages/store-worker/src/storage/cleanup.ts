import { UPLOAD_RESERVATION_TTL_MS } from "../db/quota.js";
import type { Env } from "../env.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** One schedule tick; see the delete cutoff below. */
export const EXPIRED_DELETE_GRACE_MS = 15 * 60 * 1000;
/** R2's cap per delete call; a longer list must be sliced. */
const DELETE_BATCH = 1000;

/**
 * Deletes pending objects whose reservation is unfinalized and expired, then
 * prunes upload rows older than a week. `now` is the run's instant, so the
 * cutoffs are the ones `pendingBytes` and finalize compare against.
 *
 * The delete cutoff is the reservation's hour plus one schedule tick. The
 * SELECT and the delete are not atomic with finalize's check and its D1 batch,
 * and the `NOT EXISTS` clause is only a snapshot: margin puts every possible
 * finalize commit ahead of this delete. It is a bound on the platform's request
 * lifetime — a Worker request cannot sit between its expiry check and its commit
 * for a quarter hour; the platform ends it long before — not a lock. The safe
 * direction is kept: the object outlives the reservation, never the reverse.
 *
 * `NOT EXISTS` is also the guard against a future two-statement finalize: Task
 * 6.3 writes the version and releases the reservation in one batch, so it
 * should never fire, but an object a version row names is a live package and
 * must outlive the reservation that uploaded it.
 *
 * The prune follows the deletes, because the key is only known while the row
 * exists. Deletes go in slices of R2's 1000-key cap: an over-cap call throws
 * before the prune, and since every run re-selects the same rows, the backlog
 * would never shrink and each later run would fail the same way. The SELECT is
 * not paged — the seven-day prune bounds how many rows one run can see.
 */
export async function cleanupPending(
  env: Env,
  now: Date,
): Promise<{ deletedObjects: number; deletedRows: number }> {
  const expiredAt = new Date(
    now.getTime() - UPLOAD_RESERVATION_TTL_MS - EXPIRED_DELETE_GRACE_MS,
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
  for (let index = 0; index < keys.length; index += DELETE_BATCH)
    await env.BUCKET.delete(keys.slice(index, index + DELETE_BATCH));

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
