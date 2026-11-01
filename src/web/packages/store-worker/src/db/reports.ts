/**
 * The closed set of reasons a report may carry. This list owns the set; the
 * route validates against it and `migrations/0004_reports.sql` repeats it as a
 * CHECK so a writer that bypasses the route still cannot store an unknown one.
 */
export const REPORT_CATEGORIES = [
  "sexual-content",
  "violence",
  "hate",
  "harassment",
  "spam",
  "copyright",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/**
 * The closed set of report verdicts. `migrations/0005_report_resolution.sql`
 * repeats it as a CHECK, so this list owns the set a reader may see.
 *
 * `open` is awaiting the owner; `resolved` upheld the report (`outcome` carries
 * the removal reason when a takedown resolved it); `dismissed` closed it with no
 * action. Restoring an item does not reopen its reports.
 */
export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export function isReportCategory(value: unknown): value is ReportCategory {
  return (
    typeof value === "string" &&
    (REPORT_CATEGORIES as readonly string[]).includes(value)
  );
}

/** At most this many reports per account in the trailing hour. */
export const REPORT_LIMIT = 20;
const REPORT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Whether one more report fits in the account's trailing-hour window.
 *
 * A duplicate collapses onto its existing row and therefore costs no budget,
 * even when the account is at its limit and the existing row is older than the
 * window — the caller is answering, not editing. The read and the insert are
 * separate statements: a parallel burst can exceed the limit by the requests
 * already in flight, the same ceiling `presignAllowed` accepts.
 */
export async function reportAllowed(
  db: D1Database,
  userId: string,
  itemId: string,
  now: Date,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - REPORT_WINDOW_MS).toISOString();
  const counts = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM report WHERE user_id = ? AND created_at >= ?) AS n,
         (SELECT COUNT(*) FROM report WHERE user_id = ? AND item_id = ?) AS mine`,
    )
    .bind(userId, cutoff, userId, itemId)
    .first<{ n: number; mine: number }>();
  return (counts?.mine ?? 0) > 0 || (counts?.n ?? 0) < REPORT_LIMIT;
}

/**
 * Writes the report, or leaves the existing row alone when this account has
 * already reported this item. Answers whether a row was written.
 */
export async function insertReport(
  db: D1Database,
  report: {
    readonly userId: string;
    readonly itemId: string;
    readonly category: ReportCategory;
    readonly note: string | null;
    readonly at: string;
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO report (user_id, item_id, category, note, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, item_id) DO NOTHING`,
    )
    .bind(report.userId, report.itemId, report.category, report.note, report.at)
    .run();
  return result.meta.changes > 0;
}

/** One open report with the item it names, as the owner queue shows it. */
export interface OpenReportRow {
  readonly user_id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly item_status: string;
  readonly category: string;
  readonly note: string | null;
  readonly created_at: string;
}

/**
 * Every open report oldest first. The item name rides the same statement, so
 * the queue's per-item counts are tallied from these rows rather than a second
 * query that could disagree with what the owner was shown.
 */
export async function openReports(
  db: D1Database,
): Promise<readonly OpenReportRow[]> {
  const rows = await db
    .prepare(
      `SELECT r.user_id, r.item_id, i.name AS item_name,
         i.status AS item_status, r.category, r.note, r.created_at
       FROM report r
       JOIN item i ON i.id = r.item_id
       WHERE r.status = 'open'
       ORDER BY r.created_at, r.item_id, r.user_id`,
    )
    .all<OpenReportRow>();
  return rows.results;
}

/** One report's current verdict, wherever it is on the triage path. */
export async function reportStatusOf(
  db: D1Database,
  userId: string,
  itemId: string,
): Promise<ReportStatus | undefined> {
  const row = await db
    .prepare("SELECT status FROM report WHERE user_id = ? AND item_id = ?")
    .bind(userId, itemId)
    .first<{ readonly status: ReportStatus }>();
  return row?.status;
}

/**
 * The owner's verdict write. `open` is a precondition, not advice: a report
 * another request already closed answers `false` instead of being retried, and
 * the verdict instant moves on that one write.
 */
export async function setReportStatus(
  db: D1Database,
  userId: string,
  itemId: string,
  status: "resolved" | "dismissed",
  at: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE report SET status = ?, resolved_at = ?
       WHERE user_id = ? AND item_id = ? AND status = 'open'`,
    )
    .bind(status, at, userId, itemId)
    .run();
  return result.meta.changes > 0;
}

/**
 * The reporting half of a takedown, as a statement for the removal route to
 * batch with its status write. The `EXISTS` pins the verdict to the removal the
 * status write just made — same item, `removed_at` equal to that write's
 * instant — so a failed transition (an item in a state `remove` does not
 * accept) resolves nothing. `DB.batch` runs both statements in one transaction:
 * a crash leaves either both or neither.
 */
export function resolveReportsOnRemovalStatement(
  db: D1Database,
  itemId: string,
  reason: string,
  at: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE report SET status = 'resolved', outcome = ?, resolved_at = ?
       WHERE item_id = ? AND status = 'open'
         AND EXISTS (
           SELECT 1 FROM item
           WHERE id = ? AND status = 'removed' AND removed_at = ?
         )`,
    )
    .bind(reason, at, itemId, itemId, at);
}
