-- Core blob metadata
CREATE TABLE IF NOT EXISTS blobs (
  sha256    TEXT(64) PRIMARY KEY,
  size      INTEGER  NOT NULL,
  type      TEXT,                   -- MIME type, NULL if unknown
  uploaded  INTEGER  NOT NULL       -- Unix timestamp of first upload
);

-- Which pubkey uploaded which blob (many owners possible via re-upload)
CREATE TABLE IF NOT EXISTS owners (
  blob      TEXT(64) NOT NULL REFERENCES blobs(sha256) ON DELETE CASCADE,
  pubkey    TEXT(64) NOT NULL,
  PRIMARY KEY (blob, pubkey)
);

CREATE INDEX IF NOT EXISTS owners_pubkey ON owners (pubkey);

-- Last-access timestamp for LRU-based prune rules
CREATE TABLE IF NOT EXISTS accessed (
  blob      TEXT(64) PRIMARY KEY REFERENCES blobs(sha256) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS accessed_timestamp ON accessed (timestamp);
