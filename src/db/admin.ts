/**
 * Admin-console-only queries (main thread). Kept separate from blobs.ts so the
 * protocol hot path and the upload-worker RPC surface stay unchanged.
 */

import type { Client } from "@libsql/client";
import type { ReportItem, ReportsPage, ReportsQuery } from "../admin/contracts/reports.ts";
import type { UserPageQuery, UserReportsQuery, UsersQuery, UserSummary } from "../admin/contracts/users.ts";
import type { ReportRecord } from "./reports.ts";

/** Report rows before the service layer attaches the public blob path. */
export type AdminReportsRows = Omit<ReportsPage, "items"> & { items: Omit<ReportItem, "path">[] };

export async function listAdminReports(db: Client, query: ReportsQuery): Promise<AdminReportsRows> {
  const conditions = [
    "(instr(lower(r.blob), lower(?)) > 0 OR instr(lower(r.reporter), lower(?)) > 0 OR instr(lower(r.content), lower(?)) > 0 OR instr(lower(r.event_id), lower(?)) > 0)",
  ];
  const args = [query.q, query.q, query.q, query.q];
  if (query.type === "unspecified") conditions.push("r.type IS NULL");
  else if (query.type !== "all") {
    conditions.push("r.type = ?");
    args.push(query.type);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const sort = ["created", "type", "reporter", "blob"].includes(query.sort) ? query.sort : "created";
  const [rows, counts] = await db.batch([
    {
      sql: `SELECT r.*, b.type AS blob_type, b.size AS blob_size,
        (SELECT COUNT(*) FROM owners o WHERE o.blob = r.blob) AS owner_count,
        (SELECT COUNT(*) FROM reports x WHERE x.blob = r.blob) AS blob_report_count
      FROM reports r LEFT JOIN blobs b ON b.sha256 = r.blob ${where}
      ORDER BY r.${sort} ${query.dir === "asc" ? "ASC" : "DESC"}, r.id DESC LIMIT ? OFFSET ?`,
      args: [...args, query.pageSize, (query.page - 1) * query.pageSize],
    },
    { sql: `SELECT COUNT(*) AS total, COUNT(DISTINCT r.blob) AS blobs, COUNT(DISTINCT r.reporter) AS reporters FROM reports r ${where}`, args },
  ], "read");
  return {
    items: rows.rows.map((r) => ({
      id: Number(r.id),
      eventId: String(r.event_id),
      reporter: String(r.reporter),
      blob: String(r.blob),
      type: r.type as string | null,
      content: String(r.content),
      created: Number(r.created),
      blobType: r.blob_type as string | null,
      blobSize: r.blob_size == null ? null : Number(r.blob_size),
      ownerCount: Number(r.owner_count),
      blobReportCount: Number(r.blob_report_count),
    })),
    total: Number(counts.rows[0].total),
    blobCount: Number(counts.rows[0].blobs),
    reporterCount: Number(counts.rows[0].reporters),
    page: query.page,
    pageSize: query.pageSize,
  };
}

const USER_STATS = `WITH owned AS (
  SELECT o.pubkey, COUNT(*) AS blobCount, SUM(b.size) AS totalSize,
    SUM(CASE WHEN (SELECT COUNT(*) FROM owners x WHERE x.blob = o.blob) > 1 THEN 1 ELSE 0 END) AS sharedBlobCount,
    MIN(o.uploaded) AS firstUpload, MAX(o.uploaded) AS lastUpload,
    SUM((SELECT COUNT(*) FROM reports r WHERE r.blob = o.blob)) AS receivedReportCount
  FROM owners o JOIN blobs b ON b.sha256 = o.blob GROUP BY o.pubkey
), filed AS (
  SELECT reporter AS pubkey, COUNT(*) AS reportCount, MIN(created) AS firstReport, MAX(created) AS lastReport
  FROM reports GROUP BY reporter
), keys AS (SELECT pubkey FROM owned UNION SELECT pubkey FROM filed), users AS (
  SELECT k.pubkey, COALESCE(o.blobCount, 0) AS blobCount, COALESCE(o.totalSize, 0) AS totalSize,
    COALESCE(o.sharedBlobCount, 0) AS sharedBlobCount, COALESCE(f.reportCount, 0) AS reportCount,
    COALESCE(o.receivedReportCount, 0) AS receivedReportCount, o.firstUpload, o.lastUpload, f.firstReport, f.lastReport
  FROM keys k LEFT JOIN owned o ON o.pubkey = k.pubkey LEFT JOIN filed f ON f.pubkey = k.pubkey
)`;

function userRow(row: Record<string, unknown>): UserSummary {
  return {
    pubkey: String(row.pubkey),
    blobCount: Number(row.blobCount),
    totalSize: Number(row.totalSize),
    sharedBlobCount: Number(row.sharedBlobCount),
    reportCount: Number(row.reportCount),
    receivedReportCount: Number(row.receivedReportCount),
    firstUpload: row.firstUpload == null ? null : Number(row.firstUpload),
    lastUpload: row.lastUpload == null ? null : Number(row.lastUpload),
    firstReport: row.firstReport == null ? null : Number(row.firstReport),
    lastReport: row.lastReport == null ? null : Number(row.lastReport),
  };
}

export async function listUsers(db: Client, query: UsersQuery) {
  const sort = ["pubkey", "blobCount", "totalSize", "reportCount", "lastUpload"].includes(query.sort) ? query.sort : "totalSize";
  const where = `WHERE instr(pubkey, ?) > 0 ${query.role === "owners" ? "AND blobCount > 0" : query.role === "reporters" ? "AND reportCount > 0" : ""}`;
  const [rows, count] = await db.batch([
    {
      sql: `${USER_STATS} SELECT * FROM users ${where} ORDER BY ${sort} ${query.dir === "asc" ? "ASC" : "DESC"}, pubkey ASC LIMIT ? OFFSET ?`,
      args: [query.q, query.pageSize, (query.page - 1) * query.pageSize],
    },
    { sql: `${USER_STATS} SELECT COUNT(*) FROM users ${where}`, args: [query.q] },
  ], "read");
  return { items: rows.rows.map(userRow), total: Number(count.rows[0][0]), page: query.page, pageSize: query.pageSize };
}

export async function getUser(db: Client, pubkey: string): Promise<UserSummary | null> {
  const rows = await db.execute({ sql: `${USER_STATS} SELECT * FROM users WHERE pubkey = ?`, args: [pubkey] });
  return rows.rows[0] ? userRow(rows.rows[0]) : null;
}

export async function listUserBlobs(db: Client, pubkey: string, query: UserPageQuery) {
  const [rows, count] = await db.batch([
    {
      sql: `SELECT b.sha256, b.type, b.size, o.uploaded, (SELECT COUNT(*) FROM owners x WHERE x.blob = b.sha256) AS ownerCount
      FROM owners o JOIN blobs b ON b.sha256 = o.blob WHERE o.pubkey = ? ORDER BY o.uploaded DESC, b.sha256 ASC LIMIT ? OFFSET ?`,
      args: [pubkey, query.pageSize, (query.page - 1) * query.pageSize],
    },
    { sql: "SELECT COUNT(*) FROM owners o JOIN blobs b ON b.sha256 = o.blob WHERE o.pubkey = ?", args: [pubkey] },
  ], "read");
  return {
    items: rows.rows.map((r) => ({
      sha256: String(r.sha256),
      type: r.type as string | null,
      size: Number(r.size),
      uploaded: r.uploaded == null ? null : Number(r.uploaded),
      ownerCount: Number(r.ownerCount),
    })),
    total: Number(count.rows[0][0]),
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function listUserReports(db: Client, pubkey: string, query: UserReportsQuery) {
  const where = query.scope === "filed" ? "reporter = ?" : "EXISTS (SELECT 1 FROM owners o WHERE o.blob = r.blob AND o.pubkey = ?)";
  const [rows, count] = await db.batch([
    {
      sql: `SELECT r.* FROM reports r WHERE ${where} ORDER BY created DESC, id DESC LIMIT ? OFFSET ?`,
      args: [pubkey, query.pageSize, (query.page - 1) * query.pageSize],
    },
    { sql: `SELECT COUNT(*) FROM reports r WHERE ${where}`, args: [pubkey] },
  ], "read");
  const items: ReportRecord[] = rows.rows.map((r) => ({
    id: Number(r.id),
    event_id: String(r.event_id),
    reporter: String(r.reporter),
    blob: String(r.blob),
    type: r.type as ReportRecord["type"],
    content: String(r.content),
    created: Number(r.created),
  }));
  return { items, total: Number(count.rows[0][0]), page: query.page, pageSize: query.pageSize };
}

export interface BlobOwnerRecord {
  pubkey: string;
  /** When this pubkey gained ownership; null only for rows the backfill could not date. */
  uploaded: number | null;
}

export interface BlobRelations {
  owners: BlobOwnerRecord[];
  accessed: number | null;
  /** Original (pre-optimization) hashes that were optimized into this blob. */
  derivedFrom: string[];
  /** Generated thumbnail of this blob, if any. */
  thumbnail: string | null;
  /** Parent media blob when this blob is a generated thumbnail. */
  thumbnailOf: string | null;
}

export async function getBlobRelations(db: Client, sha256: string): Promise<BlobRelations> {
  const results = await db.batch([
    { sql: "SELECT pubkey, uploaded FROM owners WHERE blob = ? ORDER BY uploaded ASC, pubkey ASC", args: [sha256] },
    { sql: "SELECT timestamp FROM accessed WHERE blob = ?", args: [sha256] },
    { sql: "SELECT original_sha256 FROM media_derivatives WHERE optimized_sha256 = ? LIMIT 100", args: [sha256] },
    { sql: "SELECT thumbnail_sha256 FROM media_thumbnails WHERE parent_sha256 = ? LIMIT 1", args: [sha256] },
    { sql: "SELECT parent_sha256 FROM media_thumbnails WHERE thumbnail_sha256 = ? LIMIT 1", args: [sha256] },
  ], "read");
  const [owners, accessed, derived, thumbnail, thumbnailOf] = results;
  return {
    owners: owners.rows.map((row) => ({ pubkey: row[0] as string, uploaded: (row[1] as number | null) ?? null })),
    accessed: (accessed.rows[0]?.[0] as number | undefined) ?? null,
    derivedFrom: derived.rows.map((row) => row[0] as string),
    thumbnail: (thumbnail.rows[0]?.[0] as string | undefined) ?? null,
    thumbnailOf: (thumbnailOf.rows[0]?.[0] as string | undefined) ?? null,
  };
}

/** Count current owners/reporters and retained reports for the dashboard. */
export async function getAdminCounts(db: Client): Promise<{ userCount: number; reportCount: number; reportedBlobCount: number }> {
  const [users, reports] = await db.batch([
    "SELECT COUNT(*) FROM (SELECT pubkey FROM owners UNION SELECT reporter FROM reports)",
    "SELECT COUNT(*), COUNT(DISTINCT blob) FROM reports",
  ], "read");
  return {
    userCount: Number(users.rows[0]?.[0] ?? 0),
    reportCount: Number(reports.rows[0]?.[0] ?? 0),
    reportedBlobCount: Number(reports.rows[0]?.[1] ?? 0),
  };
}
