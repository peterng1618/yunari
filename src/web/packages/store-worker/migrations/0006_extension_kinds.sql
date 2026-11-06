ALTER TABLE item ADD COLUMN publisher TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN review_state TEXT NOT NULL DEFAULT 'none'
  CHECK (review_state IN ('none', 'pending', 'approved', 'rejected'));

ALTER TABLE item_version ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE item_version ADD COLUMN execution_profile TEXT;
ALTER TABLE item_version ADD COLUMN review_state TEXT NOT NULL DEFAULT 'none'
  CHECK (review_state IN ('none', 'pending', 'approved', 'rejected'));

-- The submission a finalize later verifies. `declared_sha256`/`declared_bytes`
-- are the package the author said they uploaded, kept on the pending record so
-- the version request and its finalize share one owner without a client-passed
-- version. A dashboard theme leaves both null, as it always did.
ALTER TABLE presign_event ADD COLUMN kind TEXT NOT NULL DEFAULT 'dashboard-theme';
ALTER TABLE presign_event ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE presign_event ADD COLUMN declared_sha256 TEXT;
ALTER TABLE presign_event ADD COLUMN declared_bytes INTEGER;
ALTER TABLE presign_event ADD COLUMN execution_profile TEXT;

CREATE TABLE kill_list (
  plugin_key TEXT PRIMARY KEY,
  advisory_url TEXT,
  created_at TEXT NOT NULL
);
