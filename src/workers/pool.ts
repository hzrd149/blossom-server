/**
 * UploadWorkerPool — pre-warmed pool of upload workers.
 *
 * Each worker:
 *   - Is a persistent Deno Worker (separate V8 isolate, no per-upload startup cost)
 *   - Owns a persistent MessageChannel DB port (transferred at init, reused forever)
 *   - Handles exactly one upload job at a time
 *   - Receives the full request body stream (zero-copy transfer via postMessage)
 *   - Writes to a temp path + computes SHA-256 concurrently
 *   - Posts { hash, size } back on success, { error } on failure
 *
 * Pool policy:
 *   - No queue — pool full → dispatch() returns null → route returns 503
 *   - Rejection happens before any body bytes are read (fast, ~6ms)
 */

import type { Client } from "@libsql/client";
import { installDbBridge } from "../db/bridge.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadJobResult {
  hash: string;
  size: number;
}

interface PendingJob {
  resolve: (result: UploadJobResult) => void;
  reject: (err: Error) => void;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

export class UploadWorkerPool {
  private workers: WorkerState[] = [];
  private pending = new Map<string, PendingJob>();
  private jobCounter = 0;

  constructor(size: number, db: Client) {
    for (let i = 0; i < size; i++) {
      const { port1, port2 } = new MessageChannel();

      const worker = new Worker(
        new URL("./upload-worker.ts", import.meta.url),
        { type: "module" },
      );

      const state: WorkerState = { worker, busy: false };

      // Send the DB port to the worker (transferred — worker owns port2).
      // This is the one-time "init" message; all subsequent messages are jobs.
      worker.postMessage({ type: "init", dbPort: port2 }, [port2]);

      // Install the DB bridge on the main thread's side of the channel.
      installDbBridge(db, port1);

      // Route job results back to waiting Promises
      worker.onmessage = (
        event: MessageEvent<{ id: string; hash?: string; size?: number; error?: string }>,
      ) => {
        const { id, hash, size, error } = event.data;
        const pending = this.pending.get(id);
        if (!pending) return; // stale — ignore

        this.pending.delete(id);
        state.busy = false;

        if (error !== undefined) {
          pending.reject(new Error(error));
        } else {
          pending.resolve({ hash: hash!, size: size! });
        }
      };

      worker.onerror = (event) => {
        console.error(`Upload worker ${i} error:`, event.message);
        // Mark worker as free so it can accept new jobs after the error
        state.busy = false;
      };

      this.workers.push(state);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Total number of workers in the pool. */
  get size(): number {
    return this.workers.length;
  }

  /** Number of currently idle workers. */
  get available(): number {
    return this.workers.filter((w) => !w.busy).length;
  }

  /**
   * Dispatch an upload job to a free worker.
   *
   * The stream is transferred to the worker (zero-copy). The main thread
   * must NOT read from it after calling dispatch().
   *
   * @param stream    The request body ReadableStream (will be transferred).
   * @param tmpPath   Temp file path the worker should write to.
   * @param sizeHint  Content-Length value, or null if unknown.
   * @param xSha256   Declared hash from X-SHA-256 header, or null.
   *
   * @returns A Promise that resolves to { hash, size } on success,
   *          or null if no worker is available (caller should return 503).
   */
  dispatch(
    stream: ReadableStream<Uint8Array>,
    tmpPath: string,
    sizeHint: number | null,
    xSha256: string | null,
  ): Promise<UploadJobResult> | null {
    const state = this.workers.find((w) => !w.busy);
    if (!state) return null; // Pool full — caller returns 503

    state.busy = true;
    const id = String(++this.jobCounter);

    const promise = new Promise<UploadJobResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    // Transfer the stream to the worker — zero-copy, no tee on the main thread.
    state.worker.postMessage(
      { type: "job", id, stream, tmpPath, sizeHint, xSha256 },
      [stream as unknown as Transferable],
    );

    return promise;
  }

  /** Gracefully terminate all workers. */
  shutdown(): void {
    for (const { worker } of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _pool: UploadWorkerPool | null = null;

export function initPool(hashWorkers: number, db: Client): UploadWorkerPool {
  const size = hashWorkers > 0 ? hashWorkers : navigator.hardwareConcurrency;
  _pool = new UploadWorkerPool(size, db);
  console.log(`Upload worker pool initialized with ${size} workers.`);
  return _pool;
}

export function getPool(): UploadWorkerPool {
  if (!_pool) throw new Error("Worker pool not initialized. Call initPool() first.");
  return _pool;
}
