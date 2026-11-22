/**
 * Moderation queries (main thread): local pubkey and blob bans.
 * See docs/moderation/local-bans.md and src/db/migrations/008_moderation.sql. Domain code
 * reaches these through ModerationDatabase (./index.ts).
 */

import type { Client, Row } from "@libsql/client";

export interface PageQuery {
  page: number;
  pageSize: number;
  /** Optional case-insensitive substring filter. */
  q?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BannedPubkeyRecord {
  pubkey: string;
  reason: string | null;
  note: string | null;
  created: number;
}

export interface BannedBlobRecord {
  sha256: string;
  category: string;
  note: string | null;
  created: number;
}

const IN_CHUNK = 400;

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function offset(query: PageQuery): number {
  return (query.page - 1) * query.pageSize;
}

// --- Pubkey bans ---

function pubkeyRow(row: Row): BannedPubkeyRecord {
  return { pubkey: String(row.pubkey), reason: row.reason as string | null, note: row.note as string | null, created: Number(row.created) };
}

export async function loadBannedPubkeys(db: Client): Promise<string[]> {
  return (await db.execute("SELECT pubkey FROM banned_pubkeys")).rows.map((row) => String(row[0]));
}

export async function getBannedPubkey(db: Client, pubkey: string): Promise<BannedPubkeyRecord | null> {
  const rs = await db.execute({ sql: "SELECT * FROM banned_pubkeys WHERE pubkey = ?", args: [pubkey] });
  return rs.rows[0] ? pubkeyRow(rs.rows[0]) : null;
}

/** Insert or update a pubkey ban. Keeps the original `created` on update. */
export async function upsertBannedPubkey(db: Client, record: Omit<BannedPubkeyRecord, "created"> & { created?: number }): Promise<void> {
  await db.execute({
    sql: `INSERT INTO banned_pubkeys (pubkey, reason, note, created) VALUES (?, ?, ?, ?)
          ON CONFLICT(pubkey) DO UPDATE SET reason = excluded.reason, note = excluded.note`,
    args: [record.pubkey, record.reason, record.note, record.created ?? now()],
  });
}

export async function deleteBannedPubkey(db: Client, pubkey: string): Promise<boolean> {
  const rs = await db.execute({ sql: "DELETE FROM banned_pubkeys WHERE pubkey = ?", args: [pubkey] });
  return rs.rowsAffected > 0;
}

export async function listBannedPubkeys(db: Client, query: PageQuery): Promise<Page<BannedPubkeyRecord>> {
  const q = query.q ?? "";
  const where = "WHERE instr(pubkey, lower(?)) > 0 OR instr(lower(COALESCE(note, '')), lower(?)) > 0 OR instr(COALESCE(reason, ''), lower(?)) > 0";
  const [rows, count] = await db.batch([
    { sql: `SELECT * FROM banned_pubkeys ${where} ORDER BY created DESC, pubkey ASC LIMIT ? OFFSET ?`, args: [q, q, q, query.pageSize, offset(query)] },
    { sql: `SELECT COUNT(*) FROM banned_pubkeys ${where}`, args: [q, q, q] },
  ], "read");
  return { items: rows.rows.map(pubkeyRow), total: Number(count.rows[0][0]), page: query.page, pageSize: query.pageSize };
}

/** Hashes of every blob the pubkey owns. */
export async function listOwnedBlobHashes(db: Client, pubkey: string): Promise<string[]> {
  return (await db.execute({ sql: "SELECT blob FROM owners WHERE pubkey = ?", args: [pubkey] })).rows.map((row) => String(row[0]));
}

/**
 * Remove a pubkey's ownership from the given blobs and return those left with no owners.
 * Blobs still referenced as the thumbnail of another stored blob are not orphans (they are
 * kept for that parent, as the prune candidate queries do).
 */
export async function removeOwnershipReturningOrphans(db: Client, pubkey: string, hashes: readonly string[]): Promise<string[]> {
  const orphans: string[] = [];
  for (const part of chunks(hashes)) {
    const [, rs] = await db.batch([
      { sql: `DELETE FROM owners WHERE pubkey = ? AND blob IN (${placeholders(part.length)})`, args: [pubkey, ...part] },
      {
        sql: `SELECT b.sha256 FROM blobs b WHERE b.sha256 IN (${placeholders(part.length)})
              AND NOT EXISTS (SELECT 1 FROM owners o WHERE o.blob = b.sha256)
              AND NOT EXISTS (SELECT 1 FROM media_thumbnails mt JOIN blobs p ON p.sha256 = mt.parent_sha256
                              WHERE mt.thumbnail_sha256 = b.sha256 AND p.sha256 <> b.sha256)`,
        args: part,
      },
    ], "write");
    orphans.push(...rs.rows.map((row) => String(row[0])));
  }
  return orphans;
}

/** True when a thumbnail has owners or is the thumbnail of a stored blob other than `parent`. */
export async function isThumbnailStillUsed(db: Client, thumbnail: string, parent: string): Promise<boolean> {
  const rs = await db.execute({
    sql: `SELECT EXISTS (SELECT 1 FROM owners o WHERE o.blob = ?)
            OR EXISTS (SELECT 1 FROM media_thumbnails mt JOIN blobs p ON p.sha256 = mt.parent_sha256
                       WHERE mt.thumbnail_sha256 = ? AND mt.parent_sha256 <> ?)`,
    args: [thumbnail, thumbnail, parent],
  });
  return Number(rs.rows[0][0]) === 1;
}

// --- Blob bans ---

function bannedBlobRow(row: Row): BannedBlobRecord {
  return {
    sha256: String(row.sha256),
    category: String(row.category),
    note: row.note as string | null,
    created: Number(row.created),
  };
}

export async function getBannedBlob(db: Client, sha256: string): Promise<BannedBlobRecord | null> {
  const rs = await db.execute({ sql: "SELECT * FROM banned_blobs WHERE sha256 = ?", args: [sha256] });
  return rs.rows[0] ? bannedBlobRow(rs.rows[0]) : null;
}

export async function isBlobBanned(db: Client, sha256: string): Promise<boolean> {
  const rs = await db.execute({ sql: "SELECT 1 FROM banned_blobs WHERE sha256 = ? LIMIT 1", args: [sha256] });
  return rs.rows.length > 0;
}

/**
 * Insert or update blob bans in one transaction. An existing ban keeps its `created` time and
 * note unless a new note is given.
 */
export async function upsertBannedBlobs(
  db: Client,
  records: readonly Omit<BannedBlobRecord, "created">[],
  created = now(),
): Promise<void> {
  if (records.length === 0) return;
  await db.batch(
    records.map((record) => ({
      sql: `INSERT INTO banned_blobs (sha256, category, note, created) VALUES (?, ?, ?, ?)
            ON CONFLICT(sha256) DO UPDATE SET category = excluded.category, note = COALESCE(excluded.note, banned_blobs.note)`,
      args: [record.sha256, record.category, record.note, created],
    })),
    "write",
  );
}

/** Lift a blob ban. Returns false when the hash was not banned. */
export async function deleteBannedBlob(db: Client, sha256: string): Promise<boolean> {
  const rs = await db.execute({ sql: "DELETE FROM banned_blobs WHERE sha256 = ?", args: [sha256] });
  return rs.rowsAffected > 0;
}

export async function listBannedBlobs(db: Client, query: PageQuery & { category?: string }): Promise<Page<BannedBlobRecord>> {
  const q = query.q ?? "";
  const conditions = ["(instr(sha256, lower(?)) > 0 OR instr(lower(COALESCE(note, '')), lower(?)) > 0)"];
  const args: (string | number)[] = [q, q];
  if (query.category) {
    conditions.push("category = ?");
    args.push(query.category);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const [rows, count] = await db.batch([
    { sql: `SELECT * FROM banned_blobs ${where} ORDER BY created DESC, sha256 ASC LIMIT ? OFFSET ?`, args: [...args, query.pageSize, offset(query)] },
    { sql: `SELECT COUNT(*) FROM banned_blobs ${where}`, args },
  ], "read");
  return { items: rows.rows.map(bannedBlobRow), total: Number(count.rows[0][0]), page: query.page, pageSize: query.pageSize };
}

/**
 * Hashes related to a blob by media processing: its optimized derivative, the originals it was
 * derived from, and the thumbnails of all of these. Excludes `sha256` itself.
 */
export async function getRelatedHashes(db: Client, sha256: string): Promise<string[]> {
  const [derivative, originals] = await db.batch([
    { sql: "SELECT optimized_sha256 FROM media_derivatives WHERE original_sha256 = ?", args: [sha256] },
    { sql: "SELECT original_sha256 FROM media_derivatives WHERE optimized_sha256 = ? LIMIT 1000", args: [sha256] },
  ], "read");
  const family = new Set<string>([sha256, ...derivative.rows.map((r) => String(r[0])), ...originals.rows.map((r) => String(r[0]))]);
  const parents = [...family];
  for (const part of chunks(parents)) {
    const rs = await db.execute({
      sql: `SELECT thumbnail_sha256 FROM media_thumbnails WHERE parent_sha256 IN (${placeholders(part.length)})`,
      args: part,
    });
    for (const row of rs.rows) family.add(String(row[0]));
  }
  family.delete(sha256);
  return [...family];
}

/** Resolve (delete) every report for the given hashes. */
export async function deleteReportsForBlobs(db: Client, hashes: readonly string[]): Promise<number> {
  let removed = 0;
  for (const part of chunks(hashes)) {
    const rs = await db.execute({ sql: `DELETE FROM reports WHERE blob IN (${placeholders(part.length)})`, args: part });
    removed += rs.rowsAffected;
  }
  return removed;
}
