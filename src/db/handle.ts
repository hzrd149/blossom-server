/**
 * IDbHandle — the database interface workers program against.
 *
 * Both DbProxy (message-channel, used for local SQLite) and DirectDbHandle
 * (direct libSQL client, used for remote Turso) implement this interface.
 * Worker code imports only this type and is unaware of which backend is active.
 */

import type {
  AdminBlobRecord,
  AdminUserRecord,
  BlobRecord,
  BlobStats,
} from "./blobs.ts";
import type { ReportRecord } from "./reports.ts";

export type { AdminBlobRecord, AdminUserRecord, BlobRecord, BlobStats };
export type { ReportRecord };

export interface IDbHandle {
  // ── Core blob ops ──────────────────────────────────────────────────────────
  hasBlob(sha256: string): Promise<boolean>;
  getBlob(sha256: string): Promise<BlobRecord | null>;
  insertBlob(blob: BlobRecord, uploaderPubkey: string): Promise<void>;
  isOwner(sha256: string, pubkey: string): Promise<boolean>;
  getStats(): Promise<BlobStats>;

  // ── Admin blob ops ─────────────────────────────────────────────────────────
  listAllBlobs(opts?: {
    filter?: { q?: string; type?: string | string[] };
    sort?: [string, string];
    limit?: number;
    offset?: number;
  }): Promise<AdminBlobRecord[]>;
  countBlobs(
    filter?: { q?: string; type?: string | string[] },
  ): Promise<number>;
  listAllUsers(opts?: {
    filter?: { q?: string; pubkey?: string };
    sort?: [string, string];
    limit?: number;
    offset?: number;
  }): Promise<AdminUserRecord[]>;
  countUsers(filter?: { q?: string; pubkey?: string }): Promise<number>;
  deleteBlob(sha256: string): Promise<boolean>;
  listBlobsByPubkeyAdmin(
    pubkey: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<BlobRecord[]>;
  countBlobsByPubkey(pubkey: string): Promise<number>;

  // ── Admin report ops ───────────────────────────────────────────────────────
  listAllReports(opts?: {
    filter?: { q?: string; blob?: string; type?: string };
    sort?: [string, string];
    limit?: number;
    offset?: number;
  }): Promise<ReportRecord[]>;
  countReports(
    filter?: { q?: string; blob?: string; type?: string },
  ): Promise<number>;
  getReport(id: number): Promise<ReportRecord | null>;
  deleteReport(id: number): Promise<boolean>;
  deleteReportsByBlob(blob: string): Promise<void>;
}
