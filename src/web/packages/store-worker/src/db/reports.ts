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
