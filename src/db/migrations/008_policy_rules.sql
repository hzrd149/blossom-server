-- Key-value runtime settings (seed flags, policy versions).
CREATE TABLE IF NOT EXISTS settings (
  key      TEXT PRIMARY KEY,
  value    TEXT    NOT NULL,
  updated  INTEGER NOT NULL
);

-- Database-managed storage rules (storage.rulesManagement = database).
-- Ordered first-match list. pubkeys is a JSON array of hex pubkeys or NULL.
CREATE TABLE IF NOT EXISTS storage_rules (
  id          INTEGER PRIMARY KEY,
  position    INTEGER NOT NULL,
  type        TEXT    NOT NULL,
  expiration  TEXT    NOT NULL,
  basis       TEXT    CHECK (basis IN ('accessed', 'uploaded')),
  pubkeys     TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS storage_rules_position ON storage_rules (position);
