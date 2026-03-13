-- Maps original (pre-optimization) SHA-256 → optimized (post-optimization) SHA-256.
-- Allows PUT /media to short-circuit optimization when the same original was
-- already processed. ON DELETE CASCADE from blobs ensures cleanup if the
-- optimized blob is ever pruned.
CREATE TABLE IF NOT EXISTS media_derivatives (
  original_sha256   TEXT(64) NOT NULL,
  optimized_sha256  TEXT(64) NOT NULL REFERENCES blobs(sha256) ON DELETE CASCADE,
  PRIMARY KEY (original_sha256)
);
