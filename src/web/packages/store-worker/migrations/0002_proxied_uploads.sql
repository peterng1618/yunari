-- A proxied upload's reservation: the row is written before the package is
-- stored, so the author's quota counts bytes that have no item_version yet.
-- Finalize sets finalized_at and bytes; until then reserved_bytes is the cap.
CREATE TABLE upload (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  key TEXT NOT NULL,
  reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes >= 0),
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  bytes INTEGER CHECK (bytes IS NULL OR bytes >= 0)
);

CREATE INDEX upload_user_id_created_at ON upload (user_id, created_at);
CREATE INDEX upload_item_version ON upload (item_id, version);
