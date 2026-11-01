-- A report is triaged once. `open` is the owner's queue; `resolved` upholds
-- the report (a removal resolves every open report on the item and records the
-- removal reason in `outcome`); `dismissed` closes it without action. The status
-- set is owned by `src/db/reports.ts`, and the CHECK repeats it at the database
-- boundary so a writer cannot store a value no reader knows.
--
-- `outcome` is the sentence the verdict carries. It is set by an automatic
-- removal; a manual resolve or dismiss records its verdict in `status` and the
-- instant in `resolved_at`. A removed item that is later restored does not
-- reopen its reports: the triage already happened.
ALTER TABLE report ADD COLUMN status TEXT NOT NULL DEFAULT 'open'
  CHECK (status IN ('open', 'resolved', 'dismissed'));
ALTER TABLE report ADD COLUMN outcome TEXT;
ALTER TABLE report ADD COLUMN resolved_at TEXT;

-- The owner queue and the removal write both filter on `status` by item.
CREATE INDEX report_status_item ON report (status, item_id);
