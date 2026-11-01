-- A report is one account's complaint about one published item. The primary
-- key is the dedupe rule: a repeat report from the same account on the same
-- item collapses onto the row it already has. The category set is owned by
-- `src/db/reports.ts`; the CHECK repeats it at the database boundary so a
-- writer cannot store a value no reader knows.
CREATE TABLE report (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'sexual-content', 'violence', 'hate', 'harassment', 'spam', 'copyright',
      'other'
    )
  ),
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- The per-user trailing-hour count the rate limit reads.
CREATE INDEX report_user_id_created_at ON report (user_id, created_at);
