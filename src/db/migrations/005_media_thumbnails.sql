-- Maps optimized media blobs to generated thumbnail blobs.
-- Thumbnail blobs are intentionally ownerless, but this relationship keeps them
-- out of ownerless cleanup while the parent exists and lets delete/prune remove
-- the physical thumbnail file when the parent media blob is deleted.
CREATE TABLE IF NOT EXISTS media_thumbnails (
  parent_sha256     TEXT(64) PRIMARY KEY REFERENCES blobs(sha256) ON DELETE CASCADE,
  thumbnail_sha256  TEXT(64) NOT NULL REFERENCES blobs(sha256) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS media_thumbnails_thumbnail ON media_thumbnails (thumbnail_sha256);
