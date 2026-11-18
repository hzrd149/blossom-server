-- Per-owner upload time. blobs.uploaded records the first upload of the bytes,
-- while owners.uploaded records when each pubkey gained ownership (first upload
-- or a later dedup grant), enabling per-user activity series and quotas.
-- Rows created before this migration are backfilled from blobs.uploaded.
ALTER TABLE owners ADD COLUMN uploaded INTEGER;
UPDATE owners SET uploaded = (SELECT b.uploaded FROM blobs b WHERE b.sha256 = owners.blob) WHERE uploaded IS NULL;
CREATE INDEX IF NOT EXISTS owners_pubkey_uploaded ON owners (pubkey, uploaded);
CREATE INDEX IF NOT EXISTS owners_uploaded ON owners (uploaded);
