/**
 * DirectDbHandle — IDbHandle implementation for remote libSQL / Turso.
 *
 * Wraps a real @libsql/client Client and delegates to the same named functions
 * in src/db/blobs.ts that the main thread uses. Workers instantiate this
 * directly (no MessageChannel needed) because a network-backed libSQL client
 * is thread-safe and has no file-handle affinity.
 */

import type { Client } from "@libsql/client";
import {
  type AdminBlobRecord,
  type AdminUserRecord,
  countBlobs,
  countBlobsByPubkey,
  countUsers,
  deleteBlob,
  getBlob,
  getBlobStats,
  hasBlob,
  insertBlob,
  isOwner,
  listAllBlobs,
  listAllUsers,
  listBlobsByPubkeyAdmin,
} from "./blobs.ts";
import {
  countReports,
  deleteReport,
  deleteReportsByBlob,
  getReport,
  listAllReports,
  type ReportRecord,
} from "./reports.ts";
import type { IDbHandle } from "./handle.ts";
import type { BlobRecord, BlobStats } from "./blobs.ts";

export class DirectDbHandle implements IDbHandle {
  constructor(private client: Client) {}

  // ── Core blob ops ──────────────────────────────────────────────────────────

  hasBlob(sha256: string): Promise<boolean> {
    return hasBlob(this.client, sha256);
  }

  getBlob(sha256: string): Promise<BlobRecord | null> {
    return getBlob(this.client, sha256);
  }

  insertBlob(blob: BlobRecord, uploaderPubkey: string): Promise<void> {
    return insertBlob(this.client, blob, uploaderPubkey);
  }

  isOwner(sha256: string, pubkey: string): Promise<boolean> {
    return isOwner(this.client, sha256, pubkey);
  }

  getStats(): Promise<BlobStats> {
    return getBlobStats(this.client);
  }

  // ── Admin blob ops ─────────────────────────────────────────────────────────

  listAllBlobs(
    opts?: Parameters<IDbHandle["listAllBlobs"]>[0],
  ): Promise<AdminBlobRecord[]> {
    return listAllBlobs(this.client, opts);
  }

  countBlobs(filter?: Parameters<IDbHandle["countBlobs"]>[0]): Promise<number> {
    return countBlobs(this.client, filter);
  }

  listAllUsers(
    opts?: Parameters<IDbHandle["listAllUsers"]>[0],
  ): Promise<AdminUserRecord[]> {
    return listAllUsers(this.client, opts);
  }

  countUsers(filter?: Parameters<IDbHandle["countUsers"]>[0]): Promise<number> {
    return countUsers(this.client, filter);
  }

  deleteBlob(sha256: string): Promise<boolean> {
    return deleteBlob(this.client, sha256);
  }

  listBlobsByPubkeyAdmin(
    pubkey: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<import("./blobs.ts").BlobRecord[]> {
    return listBlobsByPubkeyAdmin(this.client, pubkey, opts ?? {});
  }

  countBlobsByPubkey(pubkey: string): Promise<number> {
    return countBlobsByPubkey(this.client, pubkey);
  }

  // ── Admin report ops ───────────────────────────────────────────────────────

  listAllReports(
    opts?: Parameters<IDbHandle["listAllReports"]>[0],
  ): Promise<ReportRecord[]> {
    return listAllReports(this.client, opts);
  }

  countReports(
    filter?: Parameters<IDbHandle["countReports"]>[0],
  ): Promise<number> {
    return countReports(this.client, filter);
  }

  getReport(id: number): Promise<ReportRecord | null> {
    return getReport(this.client, id);
  }

  deleteReport(id: number): Promise<boolean> {
    return deleteReport(this.client, id);
  }

  deleteReportsByBlob(blob: string): Promise<void> {
    return deleteReportsByBlob(this.client, blob);
  }
}
