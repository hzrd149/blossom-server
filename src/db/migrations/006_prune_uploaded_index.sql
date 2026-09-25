-- Index supporting the prune engine's expiry scan.
--
-- Expiry is evaluated against a blob's last-access time, falling back to its
-- upload time when it has never been accessed. The accessed.timestamp column
-- already has an index from 001_initial.sql, but blobs.uploaded did not, so
-- the never-accessed half of that predicate forced a full table scan of blobs.
-- Composite indexes also support deterministic cursor pagination, which lets a
-- failed deletion be skipped until the next bounded sweep instead of blocking
-- every later batch.
--
-- Note for future migrations: the runner in client.ts splits files on the
-- statement separator without parsing comments, so putting that character in
-- a comment silently cuts the statement in half.
DROP INDEX IF EXISTS blobs_uploaded;
DROP INDEX IF EXISTS accessed_timestamp;
CREATE INDEX IF NOT EXISTS blobs_uploaded_sha256 ON blobs (uploaded, sha256);
CREATE INDEX IF NOT EXISTS accessed_timestamp_blob ON accessed (timestamp, blob);
