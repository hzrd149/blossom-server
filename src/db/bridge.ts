/**
 * DB Bridge — main thread side of the worker↔DB MessageChannel.
 *
 * Installed once per worker at pool init. Receives named DB operation
 * requests from a worker, executes them against the real LibSQL client,
 * and posts results back.
 *
 * Security: explicit named-op allowlist only. Workers cannot send arbitrary
 * SQL. The TypeScript discriminated union + `never` exhaustive check ensures
 * any future op added to the type must also be handled here.
 */

import type { Client } from "@libsql/client";
import {
  type BlobRecord,
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
} from "./reports.ts";

// ---------------------------------------------------------------------------
// Wire types (structured-cloned over MessageChannel)
// ---------------------------------------------------------------------------

export type DbRequest =
  | { reqId: number; op: "hasBlob"; args: [sha256: string] }
  | { reqId: number; op: "getBlob"; args: [sha256: string] }
  | {
    reqId: number;
    op: "insertBlob";
    args: [blob: BlobRecord, uploaderPubkey: string];
  }
  | { reqId: number; op: "isOwner"; args: [sha256: string, pubkey: string] }
  | { reqId: number; op: "getStats"; args: [] }
  // ── Admin ops ──────────────────────────────────────────────────────────────
  | {
    reqId: number;
    op: "listAllBlobs";
    args: [opts: Parameters<typeof listAllBlobs>[1]];
  }
  | {
    reqId: number;
    op: "countBlobs";
    args: [filter: Parameters<typeof countBlobs>[1]];
  }
  | {
    reqId: number;
    op: "listAllUsers";
    args: [opts: Parameters<typeof listAllUsers>[1]];
  }
  | {
    reqId: number;
    op: "countUsers";
    args: [filter: Parameters<typeof countUsers>[1]];
  }
  | {
    reqId: number;
    op: "listAllReports";
    args: [opts: Parameters<typeof listAllReports>[1]];
  }
  | {
    reqId: number;
    op: "countReports";
    args: [filter: Parameters<typeof countReports>[1]];
  }
  | { reqId: number; op: "getReport"; args: [id: number] }
  | { reqId: number; op: "deleteBlob"; args: [sha256: string] }
  | { reqId: number; op: "deleteReport"; args: [id: number] }
  | { reqId: number; op: "deleteReportsByBlob"; args: [blob: string] }
  | {
    reqId: number;
    op: "listBlobsByPubkeyAdmin";
    args: [pubkey: string, opts: { limit?: number; offset?: number }];
  }
  | { reqId: number; op: "countBlobsByPubkey"; args: [pubkey: string] };

export interface DbResponse {
  reqId: number;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Bridge installer
// ---------------------------------------------------------------------------

/**
 * Install a DB bridge on a MessagePort.
 *
 * Call once per worker during pool construction:
 *   const { port1, port2 } = new MessageChannel();
 *   installDbBridge(db, port1);                         // main thread owns port1
 *   worker.postMessage({ dbPort: port2 }, [port2]);     // transfer port2 to worker
 */
export function installDbBridge(db: Client, port: MessagePort): void {
  port.onmessage = async (event: MessageEvent<DbRequest>) => {
    const msg = event.data;

    try {
      let result: unknown;

      switch (msg.op) {
        case "hasBlob":
          result = await hasBlob(db, msg.args[0]);
          break;

        case "getBlob":
          result = await getBlob(db, msg.args[0]);
          break;

        case "insertBlob":
          result = await insertBlob(db, msg.args[0], msg.args[1]);
          break;

        case "isOwner":
          result = await isOwner(db, msg.args[0], msg.args[1]);
          break;

        case "getStats":
          result = await getBlobStats(db);
          break;

        // ── Admin ops ────────────────────────────────────────────────────────

        case "listAllBlobs":
          result = await listAllBlobs(db, msg.args[0]);
          break;

        case "countBlobs":
          result = await countBlobs(db, msg.args[0]);
          break;

        case "listAllUsers":
          result = await listAllUsers(db, msg.args[0]);
          break;

        case "countUsers":
          result = await countUsers(db, msg.args[0]);
          break;

        case "listAllReports":
          result = await listAllReports(db, msg.args[0]);
          break;

        case "countReports":
          result = await countReports(db, msg.args[0]);
          break;

        case "getReport":
          result = await getReport(db, msg.args[0]);
          break;

        case "deleteBlob":
          result = await deleteBlob(db, msg.args[0]);
          break;

        case "deleteReport":
          result = await deleteReport(db, msg.args[0]);
          break;

        case "deleteReportsByBlob":
          result = await deleteReportsByBlob(db, msg.args[0]);
          break;

        case "listBlobsByPubkeyAdmin":
          result = await listBlobsByPubkeyAdmin(db, msg.args[0], msg.args[1]);
          break;

        case "countBlobsByPubkey":
          result = await countBlobsByPubkey(db, msg.args[0]);
          break;

        default: {
          // Exhaustive check: if a new op is added to DbRequest but not
          // handled above, TypeScript makes this a compile error.
          const _exhaustive: never = msg;
          port.postMessage(
            {
              reqId: (_exhaustive as DbRequest).reqId,
              error: `Unknown DB op`,
            } satisfies DbResponse,
          );
          return;
        }
      }

      port.postMessage({ reqId: msg.reqId, result } satisfies DbResponse);
    } catch (err) {
      port.postMessage(
        {
          reqId: msg.reqId,
          error: err instanceof Error ? err.message : String(err),
        } satisfies DbResponse,
      );
    }
  };
}
