/**
 * The author limits set to fit the free tier. They are defaults, not measured
 * against usage. Exported
 * because the route's reservation insert re-checks both ceilings as a fast
 * path; `createDraft`'s guarded insert is the item ceiling's atomic gate.
 */
export const MAX_AUTHOR_ITEMS = 20;
export const MAX_AUTHOR_BYTES = 1024 * 1024 * 1024;
const PRESIGN_WINDOW_MS = 60 * 60 * 1000;
const PRESIGN_LIMIT = 60;

/** A proxied upload that never finalizes stops reserving after this long. */
export const UPLOAD_RESERVATION_TTL_MS = 60 * 60 * 1000;

/**
 * Bytes an author's unexpired proxied uploads still hold. A finalized upload
 * is not counted here: its size is already an `item_version` row. Instants are
 * fixed-width UTC ISO-8601 text from `toISOString()`, so a lexical comparison
 * against the cutoff orders them.
 */
export async function pendingBytes(
  db: D1Database,
  userId: string,
  now: Date,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - UPLOAD_RESERVATION_TTL_MS,
  ).toISOString();
  const pending = await db
    .prepare(
      `SELECT COALESCE(SUM(reserved_bytes), 0) AS total FROM upload
       WHERE user_id = ? AND finalized_at IS NULL AND created_at > ?`,
    )
    .bind(userId, cutoff)
    .first<{ total: number }>();
  return pending?.total ?? 0;
}

/**
 * Whether one more version request would break an author's quota.
 *
 * The object's real size is unknown until finalize, so `extraBytes` is the
 * archive cap: the check is conservative, and a request that passes may still
 * be refused at finalize if the package is larger than the remaining budget.
 * Unexpired proxied uploads reserve their cap too, so several in flight cannot
 * overrun the account limit before any of them finalizes.
 * `creatingNewItem` is the route's own knowledge — an existing item's new
 * version does not count against the item limit. `now` is the request's clock,
 * so the reservation cutoff is not read from a second instant; the default
 * keeps four-argument callers working.
 */
export async function authorQuotaExceeded(
  db: D1Database,
  userId: string,
  extraBytes: number,
  creatingNewItem: boolean,
  now: Date = new Date(),
): Promise<"items" | "bytes" | undefined> {
  if (!Number.isFinite(extraBytes) || extraBytes < 0) {
    throw new RangeError(
      `extraBytes must be a finite non-negative number, got ${extraBytes}.`,
    );
  }
  if (creatingNewItem) {
    const owned = await db
      .prepare("SELECT COUNT(*) AS n FROM item WHERE author_user_id = ?")
      .bind(userId)
      .first<{ n: number }>();
    if ((owned?.n ?? 0) >= MAX_AUTHOR_ITEMS) return "items";
  }

  const stored = await db
    .prepare(
      `SELECT COALESCE(SUM(v.bytes), 0) AS total FROM item_version v
       JOIN item i ON i.id = v.item_id WHERE i.author_user_id = ?`,
    )
    .bind(userId)
    .first<{ total: number }>();
  const pending = await pendingBytes(db, userId, now);
  return (stored?.total ?? 0) + pending + extraBytes > MAX_AUTHOR_BYTES
    ? "bytes"
    : undefined;
}

/**
 * At most 60 presigns in the trailing hour. Instants are ISO text, so a lexical
 * comparison against the cutoff orders them; the route records the event only
 * after this answers true, so a refused request burns no budget.
 */
export async function presignAllowed(
  db: D1Database,
  userId: string,
  now: Date,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - PRESIGN_WINDOW_MS).toISOString();
  const recent = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM presign_event WHERE user_id = ? AND at >= ?",
    )
    .bind(userId, cutoff)
    .first<{ n: number }>();
  return (recent?.n ?? 0) < PRESIGN_LIMIT;
}
