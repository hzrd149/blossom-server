-- BUD-08 / NIP-94 blob metadata tags.
-- Stored as a JSON-encoded array of NIP-94 tag tuples, e.g.
-- [["dim","640x480"],["ox","<original-sha256>"]]. NULL when no additional
-- NIP-94 metadata has been determined.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS form, so the migration runner tolerates
-- the "duplicate column name" error to keep this statement safe to re-run.
ALTER TABLE blobs ADD COLUMN nip94 TEXT;
