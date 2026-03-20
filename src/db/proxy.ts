/**
 * DB Proxy — worker-side counterpart to the main thread's DbBridge.
 *
 * Provides an API identical to the named functions in src/db/blobs.ts so
 * worker code is portable: `db.hasBlob(hash)` works the same whether the
 * caller is on the main thread (real LibSQL client) or in a worker (proxy).
 *
 * Calls are correlated with a monotonic reqId. Multiple in-flight requests
 * are supported — each resolves independently when its response arrives.
 */

import type { DbRequest, DbResponse } from "./bridge.ts";
import type { IDbHandle } from "./handle.ts";
import type { BlobRecord, BlobStats, AdminBlobRecord, AdminUserRecord } from "./blobs.ts";
import type { ReportRecord } from "./reports.ts";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class DbProxy implements IDbHandle {
  private pending = new Map<number, PendingRequest>();
  private counter = 0;

  constructor(private port: MessagePort) {
    port.onmessage = (event: MessageEvent<DbResponse>) => {
      const { reqId, result, error } = event.data;
      const pending = this.pending.get(reqId);
      if (!pending) return; // stale response after worker restart — ignore
      this.pending.delete(reqId);
      if (error !== undefined) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    };
  }

  private call<T>(op: DbRequest["op"], args: DbRequest["args"]): Promise<T> {
    const reqId = ++this.counter;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      // postMessage is fire-and-forget; response arrives on port.onmessage
      this.port.postMessage({ reqId, op, args } as DbRequest);
    });
  }

  // ---------------------------------------------------------------------------
  // Core blob ops
  // ---------------------------------------------------------------------------

  hasBlob(sha256: string): Promise<boolean> {
    return this.call<boolean>("hasBlob", [sha256]);
  }

  getBlob(sha256: string): Promise<BlobRecord | null> {
    return this.call<BlobRecord | null>("getBlob", [sha256]);
  }

  insertBlob(blob: BlobRecord, uploaderPubkey: string): Promise<void> {
    return this.call<void>("insertBlob", [blob, uploaderPubkey]);
  }

  isOwner(sha256: string, pubkey: string): Promise<boolean> {
    return this.call<boolean>("isOwner", [sha256, pubkey]);
  }

  getStats(): Promise<BlobStats> {
    return this.call<BlobStats>("getStats", []);
  }

  // ---------------------------------------------------------------------------
  // Admin blob ops
  // ---------------------------------------------------------------------------

  listAllBlobs(opts?: Parameters<IDbHandle["listAllBlobs"]>[0]): Promise<AdminBlobRecord[]> {
    return this.call<AdminBlobRecord[]>("listAllBlobs", [opts]);
  }

  countBlobs(filter?: Parameters<IDbHandle["countBlobs"]>[0]): Promise<number> {
    return this.call<number>("countBlobs", [filter]);
  }

  listAllUsers(opts?: Parameters<IDbHandle["listAllUsers"]>[0]): Promise<AdminUserRecord[]> {
    return this.call<AdminUserRecord[]>("listAllUsers", [opts]);
  }

  countUsers(filter?: Parameters<IDbHandle["countUsers"]>[0]): Promise<number> {
    return this.call<number>("countUsers", [filter]);
  }

  deleteBlob(sha256: string): Promise<boolean> {
    return this.call<boolean>("deleteBlob", [sha256]);
  }

  // ---------------------------------------------------------------------------
  // Admin report ops
  // ---------------------------------------------------------------------------

  listAllReports(opts?: Parameters<IDbHandle["listAllReports"]>[0]): Promise<ReportRecord[]> {
    return this.call<ReportRecord[]>("listAllReports", [opts]);
  }

  countReports(filter?: Parameters<IDbHandle["countReports"]>[0]): Promise<number> {
    return this.call<number>("countReports", [filter]);
  }

  getReport(id: number): Promise<ReportRecord | null> {
    return this.call<ReportRecord | null>("getReport", [id]);
  }

  deleteReport(id: number): Promise<boolean> {
    return this.call<boolean>("deleteReport", [id]);
  }

  deleteReportsByBlob(blob: string): Promise<void> {
    return this.call<void>("deleteReportsByBlob", [blob]);
  }
}
