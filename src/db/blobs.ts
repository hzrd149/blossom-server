import type { Client } from "@libsql/client";

export interface BlobStats {
  blobCount: number;
  totalSize: number;
  dailyUploads: number;
}

export interface BlobRecord {
  sha256: string;
  size: number;
  type: string | null;
  uploaded: number;
}

export async function getBlob(
  db: Client,
  sha256: string,
): Promise<BlobRecord | null> {
  const rs = await db.execute({
    sql: "SELECT sha256, size, type, uploaded FROM blobs WHERE sha256 = ?",
    args: [sha256],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    sha256: row[0] as string,
    size: row[1] as number,
    type: row[2] as string | null,
    uploaded: row[3] as number,
  };
}

export async function hasBlob(db: Client, sha256: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "SELECT 1 FROM blobs WHERE sha256 = ? LIMIT 1",
    args: [sha256],
  });
  return rs.rows.length > 0;
}

export async function insertBlob(
  db: Client,
  blob: BlobRecord,
  uploaderPubkey: string,
): Promise<void> {
  await db.batch([
    {
      sql:
        `INSERT OR IGNORE INTO blobs (sha256, size, type, uploaded) VALUES (?, ?, ?, ?)`,
      args: [blob.sha256, blob.size, blob.type, blob.uploaded],
    },
    {
      sql: `INSERT OR IGNORE INTO owners (blob, pubkey) VALUES (?, ?)`,
      args: [blob.sha256, uploaderPubkey],
    },
    {
      sql: `INSERT OR REPLACE INTO accessed (blob, timestamp) VALUES (?, ?)`,
      args: [blob.sha256, blob.uploaded],
    },
  ], "write");
}

export async function deleteBlob(db: Client, sha256: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "DELETE FROM blobs WHERE sha256 = ?",
    args: [sha256],
  });
  return (rs.rowsAffected ?? 0) > 0;
}

export async function touchBlob(
  db: Client,
  sha256: string,
  timestamp: number,
): Promise<void> {
  await db.execute({
    sql: "INSERT OR REPLACE INTO accessed (blob, timestamp) VALUES (?, ?)",
    args: [sha256, timestamp],
  });
}

/** List blobs uploaded by a pubkey, sorted by upload date desc, with cursor pagination. */
export async function listBlobsByPubkey(
  db: Client,
  pubkey: string,
  opts: { limit?: number; cursor?: string; since?: number; until?: number },
): Promise<BlobRecord[]> {
  const limit = Math.min(opts.limit ?? 100, 1000);
  const conditions: string[] = ["o.pubkey = ?"];
  const args: (string | number)[] = [pubkey];

  if (opts.cursor) {
    // cursor is the sha256 of the last blob in the previous page
    // We need the uploaded timestamp of the cursor blob to paginate correctly
    const cursorRs = await db.execute({
      sql: "SELECT uploaded FROM blobs WHERE sha256 = ?",
      args: [opts.cursor],
    });
    const cursorRow = cursorRs.rows[0];
    if (cursorRow) {
      conditions.push("(b.uploaded < ? OR (b.uploaded = ? AND b.sha256 > ?))");
      args.push(cursorRow[0] as number, cursorRow[0] as number, opts.cursor);
    }
  }

  if (opts.since !== undefined) {
    conditions.push("b.uploaded >= ?");
    args.push(opts.since);
  }
  if (opts.until !== undefined) {
    conditions.push("b.uploaded <= ?");
    args.push(opts.until);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rs = await db.execute({
    sql: `SELECT b.sha256, b.size, b.type, b.uploaded
          FROM blobs b
          JOIN owners o ON o.blob = b.sha256
          ${where}
          ORDER BY b.uploaded DESC, b.sha256 ASC
          LIMIT ?`,
    args: [...args, limit],
  });

  return rs.rows.map((row) => ({
    sha256: row[0] as string,
    size: row[1] as number,
    type: row[2] as string | null,
    uploaded: row[3] as number,
  }));
}

/** Aggregate stats across all blobs: total count, total bytes, uploads in last 24h. */
export async function getBlobStats(db: Client): Promise<BlobStats> {
  const rs = await db.execute(`
    SELECT
      COUNT(*),
      COALESCE(SUM(size), 0),
      COUNT(CASE WHEN uploaded > unixepoch() - 86400 THEN 1 END)
    FROM blobs
  `);
  const row = rs.rows[0];
  return {
    blobCount: row[0] as number,
    totalSize: row[1] as number,
    dailyUploads: row[2] as number,
  };
}

/** Returns the optimized blob SHA-256 for a given original SHA-256, or null if not found. */
export async function getMediaDerivative(
  db: Client,
  originalSha256: string,
): Promise<string | null> {
  const rs = await db.execute({
    sql:
      "SELECT optimized_sha256 FROM media_derivatives WHERE original_sha256 = ? LIMIT 1",
    args: [originalSha256],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return row[0] as string;
}

/** Records an original → optimized SHA-256 mapping in media_derivatives. */
export async function insertMediaDerivative(
  db: Client,
  originalSha256: string,
  optimizedSha256: string,
): Promise<void> {
  await db.execute({
    sql:
      "INSERT OR IGNORE INTO media_derivatives (original_sha256, optimized_sha256) VALUES (?, ?)",
    args: [originalSha256, optimizedSha256],
  });
}

/** Check whether a pubkey is an owner of a blob. */
export async function isOwner(
  db: Client,
  sha256: string,
  pubkey: string,
): Promise<boolean> {
  const rs = await db.execute({
    sql: "SELECT 1 FROM owners WHERE blob = ? AND pubkey = ? LIMIT 1",
    args: [sha256, pubkey],
  });
  return rs.rows.length > 0;
}

/** Extended BlobRecord that includes last-access timestamp for prune evaluation. */
export interface BlobPruneRecord extends BlobRecord {
  /** Unix timestamp from the accessed table, or null if the blob has never been accessed. */
  accessed: number | null;
}

/**
 * Fetch blobs matching a SQL LIKE type pattern, with their last-access timestamp.
 * Used by the prune engine to evaluate rule-based expiry.
 *
 * @param typePattern  SQL LIKE pattern (e.g. "image/%", "%"). Use mimeToSqlLike() to derive this.
 * @param pubkeys      If provided, only blobs owned by one of these pubkeys are returned.
 */
export async function getBlobsForPrune(
  db: Client,
  typePattern: string,
  pubkeys?: string[],
): Promise<BlobPruneRecord[]> {
  let sql: string;
  let args: (string | number)[];

  if (pubkeys && pubkeys.length > 0) {
    const placeholders = pubkeys.map(() => "?").join(", ");
    sql = `
      SELECT b.sha256, b.size, b.type, b.uploaded, a.timestamp AS accessed
      FROM blobs b
      JOIN owners o ON o.blob = b.sha256
      LEFT JOIN accessed a ON a.blob = b.sha256
      WHERE b.type LIKE ?
        AND o.pubkey IN (${placeholders})
    `;
    args = [typePattern, ...pubkeys];
  } else {
    sql = `
      SELECT b.sha256, b.size, b.type, b.uploaded, a.timestamp AS accessed
      FROM blobs b
      LEFT JOIN accessed a ON a.blob = b.sha256
      WHERE b.type LIKE ?
    `;
    args = [typePattern];
  }

  const rs = await db.execute({ sql, args });
  return rs.rows.map((row) => ({
    sha256: row[0] as string,
    size: row[1] as number,
    type: row[2] as string | null,
    uploaded: row[3] as number,
    accessed: row[4] as number | null,
  }));
}

/**
 * Return sha256 + type for all blobs that have no entry in the owners table.
 * Used by the prune engine's removeWhenNoOwners phase.
 * The type field is needed to derive the on-disk file extension for deletion.
 */
export async function getOwnerlessBlobSha256s(
  db: Client,
): Promise<{ sha256: string; type: string | null }[]> {
  const rs = await db.execute(`
    SELECT b.sha256, b.type
    FROM blobs b
    LEFT JOIN owners o ON o.blob = b.sha256
    WHERE o.blob IS NULL
  `);
  return rs.rows.map((row) => ({
    sha256: row[0] as string,
    type: row[1] as string | null,
  }));
}
