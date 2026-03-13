import type { Client } from "@libsql/client";

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
