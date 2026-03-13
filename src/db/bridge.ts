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
import { hasBlob, getBlob, insertBlob, isOwner, getBlobStats, type BlobRecord } from "./blobs.ts";

// ---------------------------------------------------------------------------
// Wire types (structured-cloned over MessageChannel)
// ---------------------------------------------------------------------------

export type DbRequest =
  | { reqId: number; op: "hasBlob";    args: [sha256: string] }
  | { reqId: number; op: "getBlob";    args: [sha256: string] }
  | { reqId: number; op: "insertBlob"; args: [blob: BlobRecord, uploaderPubkey: string] }
  | { reqId: number; op: "isOwner";    args: [sha256: string, pubkey: string] }
  | { reqId: number; op: "getStats";   args: [] };

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

        default: {
          // Exhaustive check: if a new op is added to DbRequest but not
          // handled above, TypeScript makes this a compile error.
          const _exhaustive: never = msg;
          port.postMessage({
            reqId: (_exhaustive as DbRequest).reqId,
            error: `Unknown DB op`,
          } satisfies DbResponse);
          return;
        }
      }

      port.postMessage({ reqId: msg.reqId, result } satisfies DbResponse);
    } catch (err) {
      port.postMessage({
        reqId: msg.reqId,
        error: err instanceof Error ? err.message : String(err),
      } satisfies DbResponse);
    }
  };
}
