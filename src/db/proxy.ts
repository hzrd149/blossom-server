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
import type { BlobRecord } from "./blobs.ts";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class DbProxy {
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
  // Public API — identical signatures to src/db/blobs.ts named exports
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
}
