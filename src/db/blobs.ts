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

// ─────────────────────────────────────────────────────────────────────────────
// Admin query helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Blob record enriched with an owners array — used by the admin API. */
export interface AdminBlobRecord extends BlobRecord {
  owners: string[];
}

/** Valid column names for blob list sorting (allowlist against SQL injection). */
const BLOB_SORT_COLUMNS = new Set(["sha256", "type", "size", "uploaded"]);

/**
 * List all blobs with their owners joined. Supports filter, sort, and
 * LIMIT/OFFSET pagination for the admin react-admin data provider.
 *
 * @param opts.filter.q     Full-text search across sha256 and type columns.
 * @param opts.filter.type  Exact MIME type or array of MIME types (IN clause).
 * @param opts.sort         [column, "ASC"|"DESC"]. Column must be in BLOB_SORT_COLUMNS.
 * @param opts.limit        LIMIT clause value.
 * @param opts.offset       OFFSET clause value.
 */
export async function listAllBlobs(
  db: Client,
  opts: {
    filter?: { q?: string; type?: string | string[] };
    sort?: [string, string];
    limit?: number;
    offset?: number;
  } = {},
): Promise<AdminBlobRecord[]> {
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (opts.filter?.q) {
    conditions.push("(b.sha256 LIKE ? OR b.type LIKE ?)");
    args.push(`%${opts.filter.q}%`, `%${opts.filter.q}%`);
  }
  if (opts.filter?.type !== undefined) {
    const types = Array.isArray(opts.filter.type) ? opts.filter.type : [opts.filter.type];
    if (types.length === 1) {
      conditions.push("b.type = ?");
      args.push(types[0]);
    } else if (types.length > 1) {
      conditions.push(`b.type IN (${types.map(() => "?").join(", ")})`);
      args.push(...types);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Validate sort column against allowlist
  const [sortCol, sortDir] = opts.sort ?? ["uploaded", "DESC"];
  const safeCol = BLOB_SORT_COLUMNS.has(sortCol) ? sortCol : "uploaded";
  const safeDir = sortDir === "ASC" ? "ASC" : "DESC";

  let sql = `
    SELECT b.sha256, b.size, b.type, b.uploaded,
           COALESCE(GROUP_CONCAT(o.pubkey, ','), '') AS owners
    FROM blobs b
    LEFT JOIN owners o ON o.blob = b.sha256
    ${where}
    GROUP BY b.sha256
    ORDER BY b.${safeCol} ${safeDir}
  `;

  if (opts.limit !== undefined) {
    sql += ` LIMIT ?`;
    args.push(opts.limit);
  }
  if (opts.offset !== undefined) {
    sql += ` OFFSET ?`;
    args.push(opts.offset);
  }

  const rs = await db.execute({ sql, args });
  return rs.rows.map((row) => ({
    sha256: row[0] as string,
    size: row[1] as number,
    type: row[2] as string | null,
    uploaded: row[3] as number,
    owners: row[4] ? (row[4] as string).split(",") : [],
  }));
}

/**
 * Count all blobs matching an optional filter.
 * Used to compute the Content-Range total for admin blob list responses.
 */
export async function countBlobs(
  db: Client,
  filter?: { q?: string; type?: string | string[] },
): Promise<number> {
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (filter?.q) {
    conditions.push("(sha256 LIKE ? OR type LIKE ?)");
    args.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter?.type !== undefined) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    if (types.length === 1) {
      conditions.push("type = ?");
      args.push(types[0]);
    } else if (types.length > 1) {
      conditions.push(`type IN (${types.map(() => "?").join(", ")})`);
      args.push(...types);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rs = await db.execute({ sql: `SELECT COUNT(*) FROM blobs ${where}`, args });
  return (rs.rows[0]?.[0] as number) ?? 0;
}

/** User record for the admin API — pubkey plus list of owned blob hashes. */
export interface AdminUserRecord {
  pubkey: string;
  blobs: string[];
}

/** Valid column names for user list sorting (allowlist). */
const USER_SORT_COLUMNS = new Set(["pubkey"]);

/**
 * List all users (distinct pubkeys in the owners table) with their blob hashes.
 * Supports filter, sort, and LIMIT/OFFSET pagination for the admin data provider.
 */
export async function listAllUsers(
  db: Client,
  opts: {
    filter?: { q?: string; pubkey?: string };
    sort?: [string, string];
    limit?: number;
    offset?: number;
  } = {},
): Promise<AdminUserRecord[]> {
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (opts.filter?.q) {
    conditions.push("o.pubkey LIKE ?");
    args.push(`%${opts.filter.q}%`);
  }
  if (opts.filter?.pubkey) {
    conditions.push("o.pubkey = ?");
    args.push(opts.filter.pubkey);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [sortCol, sortDir] = opts.sort ?? ["pubkey", "ASC"];
  const safeCol = USER_SORT_COLUMNS.has(sortCol) ? sortCol : "pubkey";
  const safeDir = sortDir === "ASC" ? "ASC" : "DESC";

  let sql = `
    SELECT o.pubkey, GROUP_CONCAT(o.blob, ',') AS blobs
    FROM owners o
    ${where}
    GROUP BY o.pubkey
    ORDER BY o.${safeCol} ${safeDir}
  `;

  if (opts.limit !== undefined) {
    sql += ` LIMIT ?`;
    args.push(opts.limit);
  }
  if (opts.offset !== undefined) {
    sql += ` OFFSET ?`;
    args.push(opts.offset);
  }

  const rs = await db.execute({ sql, args });
  return rs.rows.map((row) => ({
    pubkey: row[0] as string,
    blobs: row[1] ? (row[1] as string).split(",") : [],
  }));
}

/**
 * Count distinct users (pubkeys) matching an optional filter.
 * Used to compute the Content-Range total for admin user list responses.
 */
export async function countUsers(
  db: Client,
  filter?: { q?: string; pubkey?: string },
): Promise<number> {
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (filter?.q) {
    conditions.push("pubkey LIKE ?");
    args.push(`%${filter.q}%`);
  }
  if (filter?.pubkey) {
    conditions.push("pubkey = ?");
    args.push(filter.pubkey);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rs = await db.execute({
    sql: `SELECT COUNT(DISTINCT pubkey) FROM owners ${where}`,
    args,
  });
  return (rs.rows[0]?.[0] as number) ?? 0;
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
