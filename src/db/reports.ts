import type { Client } from "@libsql/client";

/** Valid NIP-56 report type strings. */
export const REPORT_TYPES = [
  "nudity",
  "malware",
  "profanity",
  "illegal",
  "spam",
  "impersonation",
  "other",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

/**
 * A single blob report row.
 * One row per (event_id, blob) pair — a single NIP-56 kind:1984 event
 * may report multiple blobs, producing one row per x tag.
 */
export interface ReportRecord {
  id: number;
  /** NIP-56 event id (hex) */
  event_id: string;
  /** Reporter's hex pubkey */
  reporter: string;
  /** Blob SHA-256 being reported */
  blob: string;
  /** NIP-56 report type from the x tag, e.g. "nudity", "spam". May be null if omitted. */
  type: ReportType | null;
  /** Human-readable content from the event .content field */
  content: string;
  /** Unix timestamp from the event .created_at field */
  created: number;
}

/**
 * Insert a single report row.
 * Uses INSERT OR IGNORE so submitting the same event for the same blob twice
 * is idempotent — no error, no duplicate rows.
 */
export async function insertReport(
  db: Client,
  report: Omit<ReportRecord, "id">,
): Promise<void> {
  await db.execute({
    sql:
      `INSERT OR IGNORE INTO reports (event_id, reporter, blob, type, content, created)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      report.event_id,
      report.reporter,
      report.blob,
      report.type,
      report.content,
      report.created,
    ],
  });
}

/** Valid column names for report list sorting (allowlist against SQL injection). */
const REPORT_SORT_COLUMNS = new Set([
  "id",
  "blob",
  "reporter",
  "type",
  "created",
]);

/**
 * List all reports with LIMIT/OFFSET pagination.
 * Supports optional filter by blob hash prefix search (q), exact blob hash,
 * or exact report type.
 */
export async function listAllReports(
  db: Client,
  opts: {
    filter?: { q?: string; blob?: string; type?: string };
    sort?: [string, string];
    limit?: number;
    offset?: number;
  } = {},
): Promise<ReportRecord[]> {
  const conditions: string[] = [];
  const args: (string | number | null)[] = [];

  if (opts.filter?.q) {
    conditions.push("(blob LIKE ? OR reporter LIKE ?)");
    args.push(`%${opts.filter.q}%`, `%${opts.filter.q}%`);
  }
  if (opts.filter?.blob) {
    conditions.push("blob = ?");
    args.push(opts.filter.blob);
  }
  if (opts.filter?.type) {
    conditions.push("type = ?");
    args.push(opts.filter.type);
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const [sortCol, sortDir] = opts.sort ?? ["created", "DESC"];
  const safeCol = REPORT_SORT_COLUMNS.has(sortCol) ? sortCol : "created";
  const safeDir = sortDir === "ASC" ? "ASC" : "DESC";

  let sql = `
    SELECT id, event_id, reporter, blob, type, content, created
    FROM reports
    ${where}
    ORDER BY ${safeCol} ${safeDir}
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
    id: row[0] as number,
    event_id: row[1] as string,
    reporter: row[2] as string,
    blob: row[3] as string,
    type: (row[4] as ReportType | null) ?? null,
    content: (row[5] as string) ?? "",
    created: row[6] as number,
  }));
}

/**
 * Count all reports matching an optional filter.
 * Used to compute the Content-Range total for admin list responses.
 */
export async function countReports(
  db: Client,
  filter?: { q?: string; blob?: string; type?: string },
): Promise<number> {
  const conditions: string[] = [];
  const args: (string | number | null)[] = [];

  if (filter?.q) {
    conditions.push("(blob LIKE ? OR reporter LIKE ?)");
    args.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter?.blob) {
    conditions.push("blob = ?");
    args.push(filter.blob);
  }
  if (filter?.type) {
    conditions.push("type = ?");
    args.push(filter.type);
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const rs = await db.execute({
    sql: `SELECT COUNT(*) FROM reports ${where}`,
    args,
  });
  return (rs.rows[0]?.[0] as number) ?? 0;
}

/** Fetch a single report by its integer primary key. Returns null if not found. */
export async function getReport(
  db: Client,
  id: number,
): Promise<ReportRecord | null> {
  const rs = await db.execute({
    sql:
      `SELECT id, event_id, reporter, blob, type, content, created FROM reports WHERE id = ?`,
    args: [id],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    id: row[0] as number,
    event_id: row[1] as string,
    reporter: row[2] as string,
    blob: row[3] as string,
    type: (row[4] as ReportType | null) ?? null,
    content: (row[5] as string) ?? "",
    created: row[6] as number,
  };
}

/**
 * Delete a single report by its integer primary key.
 * Returns true if the row existed and was removed.
 */
export async function deleteReport(db: Client, id: number): Promise<boolean> {
  const rs = await db.execute({
    sql: "DELETE FROM reports WHERE id = ?",
    args: [id],
  });
  return (rs.rowsAffected ?? 0) > 0;
}

/**
 * Delete all report rows for a given blob hash.
 * Called after an admin force-deletes a blob so that associated reports are
 * automatically dismissed in the same action.
 */
export async function deleteReportsByBlob(
  db: Client,
  blob: string,
): Promise<void> {
  await db.execute({
    sql: "DELETE FROM reports WHERE blob = ?",
    args: [blob],
  });
}
