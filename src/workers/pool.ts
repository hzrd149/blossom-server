/**
 * UploadWorkerPool — pre-warmed pool of upload workers.
 *
 * Each worker:
 *   - Is a persistent Deno Worker (separate V8 isolate, no per-upload startup cost)
 *   - Handles up to maxJobsPerWorker concurrent upload jobs
 *   - Receives the full request body stream (zero-copy transfer via postMessage)
 *   - Writes to a temp path + computes SHA-256 in a single pass
 *   - Posts { hash, size } back on success, { error } on failure
 *   - Posts { type: "throughput", bytesPerSec } once per throughputWindowMs
 *
 * Workers handle jobs concurrently because their event loops are free during
 * I/O (the pipeTo() await yields between chunks). A single slow upload does
 * not monopolise a worker slot — other jobs interleave on the same event loop.
 *
 * DB connection strategy (decided once at pool init, never inside worker code):
 *
 *   Local SQLite (file: URL)
 *     Workers cannot share a SQLite file handle across V8 isolate boundaries.
 *     Each worker gets a MessageChannel port (transferred at init). The main
 *     thread owns the real Client and executes DB ops on behalf of workers via
 *     the DbBridge. Workers use DbProxy, which has the same API as IDbHandle.
 *
 *   Remote libSQL / Turso (libsql:// or http:// URL)
 *     A network-backed libSQL client is thread-safe and has no file-handle
 *     affinity. Each worker receives the connection config and constructs its
 *     own Client directly inside the isolate. No MessageChannel needed.
 *
 * Pool policy:
 *   - No queue — all workers at capacity → dispatch() returns null → route returns 503
 *   - New jobs are routed to the worker with the lowest reported throughput
 *     (least I/O load), using bytesPerSec from the most recent heartbeat.
 *   - Rejection happens before any body bytes are read (fast, ~6ms)
 */

import type { Client } from "@libsql/client";
import { installDbBridge } from "../db/bridge.ts";
import type { DbConfig } from "../db/client.ts";

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
  /** Number of jobs currently in-flight on this worker. */
  jobCount: number;
  /** Bytes/sec reported by the most recent throughput heartbeat from this worker. */
  throughputBps: number;
}

// Messages a worker can post back.
interface ThroughputMessage {
  type: "throughput";
  bytesPerSec: number;
}

interface JobResultMessage {
  id: string;
  hash?: string;
  size?: number;
  error?: string;
}

type WorkerMessage = ThroughputMessage | JobResultMessage;

function isThroughput(msg: WorkerMessage): msg is ThroughputMessage {
  return (msg as ThroughputMessage).type === "throughput";
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

export class UploadWorkerPool {
  private workers: WorkerState[] = [];
  private pending = new Map<string, PendingJob>();
  private jobCounter = 0;
  private readonly maxJobsPerWorker: number;

  constructor(size: number, maxJobsPerWorker: number, throughputWindowMs: number, db: Client, dbConfig: DbConfig) {
    this.maxJobsPerWorker = maxJobsPerWorker;
    const remote = dbConfig.url !== undefined;

    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL("./upload-worker.ts", import.meta.url),
        { type: "module" },
      );

      const state: WorkerState = { worker, jobCount: 0, throughputBps: 0 };

      if (remote) {
        // Remote mode: worker creates its own Client from config.
        // No MessageChannel — each isolate talks directly to the DB server.
        worker.postMessage({
          type: "init",
          dbMode: "remote",
          dbUrl: dbConfig.url,
          dbAuthToken: dbConfig.authToken,
          throughputWindowMs,
        });
      } else {
        // Local SQLite mode: worker gets a MessageChannel port.
        // Main thread executes all DB ops via the bridge.
        const { port1, port2 } = new MessageChannel();
        installDbBridge(db, port1);
        worker.postMessage(
          { type: "init", dbMode: "local", dbPort: port2, throughputWindowMs },
          [port2],
        );
      }

      // Route messages from this worker back to waiting Promises or update state.
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;

        // Throughput heartbeat — update routing state, no job to settle.
        if (isThroughput(msg)) {
          state.throughputBps = msg.bytesPerSec;
          return;
        }

        // Job completion (success or error).
        const { id, hash, size, error } = msg;
        const pending = this.pending.get(id);
        if (!pending) return; // stale — ignore

        this.pending.delete(id);
        state.jobCount--;

        if (error !== undefined) {
          pending.reject(new Error(error));
        } else {
          pending.resolve({ hash: hash!, size: size! });
        }
      };

      worker.onerror = (event) => {
        console.error(`Upload worker ${i} error:`, event.message);
        // Decrement jobCount on uncaught worker error so the slot isn't leaked.
        // We don't know which job failed, so we clamp to 0 as a safe fallback.
        if (state.jobCount > 0) state.jobCount--;
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

  /** Number of workers that have capacity for at least one more job. */
  get available(): number {
    return this.workers.filter((w) => w.jobCount < this.maxJobsPerWorker).length;
  }

  /**
   * Dispatch an upload job to the least-loaded worker that has capacity.
   *
   * "Least-loaded" is determined by the lowest throughputBps from the most
   * recent heartbeat — the worker currently writing the fewest bytes/sec will
   * have the most spare event-loop headroom for a new job.
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
   *          or null if no worker has capacity (caller should return 503).
   */
  dispatch(
    stream: ReadableStream<Uint8Array>,
    tmpPath: string,
    sizeHint: number | null,
    xSha256: string | null,
  ): Promise<UploadJobResult> | null {
    // Find all workers with remaining capacity, then pick the one with the
    // lowest current throughput (least I/O load). Workers that have never
    // reported a heartbeat start at 0 bps and are preferred — correct, since
    // they are genuinely idle.
    const candidate = this.workers
      .filter((w) => w.jobCount < this.maxJobsPerWorker)
      .sort((a, b) => a.throughputBps - b.throughputBps)[0];

    if (!candidate) return null; // All workers at capacity — caller returns 503

    candidate.jobCount++;
    const id = String(++this.jobCounter);

    const promise = new Promise<UploadJobResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    // Transfer the stream to the worker — zero-copy, no tee on the main thread.
    candidate.worker.postMessage(
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

export function initPool(
  workers: number,
  maxJobsPerWorker: number,
  throughputWindowMs: number,
  db: Client,
  dbConfig: DbConfig,
): UploadWorkerPool {
  const size = workers > 0 ? workers : navigator.hardwareConcurrency;
  _pool = new UploadWorkerPool(size, maxJobsPerWorker, throughputWindowMs, db, dbConfig);
  console.log(`Upload worker pool initialized with ${size} workers (max ${maxJobsPerWorker} jobs/worker).`);
  return _pool;
}

export function getPool(): UploadWorkerPool {
  if (!_pool) {
    throw new Error("Worker pool not initialized. Call initPool() first.");
  }
  return _pool;
}
