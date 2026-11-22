-- Moderation: local pubkey and blob bans. See docs/moderation/local-bans.md.
-- Hashes and pubkeys are lowercase hex.
-- Statements are split on the statement separator, so comments must not contain it.

-- Local pubkey bans. reason is an optional NIP-56 category.
CREATE TABLE IF NOT EXISTS banned_pubkeys (
  pubkey   TEXT(64) PRIMARY KEY,
  reason   TEXT,
  note     TEXT,
  created  INTEGER  NOT NULL
);

-- Local blob bans. category is a NIP-56 report type.
CREATE TABLE IF NOT EXISTS banned_blobs (
  sha256    TEXT(64) PRIMARY KEY,
  category  TEXT     NOT NULL,
  note      TEXT,
  created   INTEGER  NOT NULL
);

CREATE INDEX IF NOT EXISTS banned_blobs_created ON banned_blobs (created DESC);
