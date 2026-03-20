-- BUD-09: blob reports (NIP-56 kind:1984 events)
-- One row per (event_id, blob) pair — a single report event can report multiple blobs.
CREATE TABLE IF NOT EXISTS reports (
  id        INTEGER  PRIMARY KEY AUTOINCREMENT,
  event_id  TEXT(64) NOT NULL,
  reporter  TEXT(64) NOT NULL,
  blob      TEXT(64) NOT NULL,
  type      TEXT,                          -- NIP-56 report type: nudity|malware|profanity|illegal|spam|impersonation|other
  content   TEXT     NOT NULL DEFAULT '',  -- human-readable content from the event
  created   INTEGER  NOT NULL,             -- event .created_at (unix timestamp)
  UNIQUE (event_id, blob)
);

CREATE INDEX IF NOT EXISTS reports_blob    ON reports (blob);
CREATE INDEX IF NOT EXISTS reports_created ON reports (created DESC);
