/**
 * HashWorkerPool — pre-warmed pool of hash workers.
 *
 * Design constraints:
 * - No queue: pool full → caller receives null immediately → route returns 503
 * - Workers are persistent (no startup cost per upload)
 * - Each worker handles exactly one upload at a time
 * - Stream is transferred (zero-copy) to the worker via postMessage
 */

interface PendingHash {
  resolve: (result: HashResult) => void;
  reject: (err: Error) => void;
}

interface HashResult {
  hash: string;
  size: number;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
}

export class HashWorkerPool {
  private workers: WorkerState[] = [];
  private pending = new Map<string, PendingHash>();
  private jobCounter = 0;

  constructor(size: number) {
    // Spawn pre-warmed workers
    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL("./hash-worker.ts", import.meta.url),
        { type: "module" },
      );

      const state: WorkerState = { worker, busy: false };

      worker.onmessage = (
        event: MessageEvent<
          { id: string; hash?: string; size?: number; error?: string }
        >,
      ) => {
        const { id, hash, size, error } = event.data;
        const pending = this.pending.get(id);
        if (!pending) return;

        this.pending.delete(id);
        state.busy = false;

        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve({ hash: hash!, size: size! });
        }
      };

      worker.onerror = (event) => {
        console.error("Hash worker error:", event.message);
      };

      this.workers.push(state);
    }
  }

  /** Returns the number of configured workers. */
  get size(): number {
    return this.workers.length;
  }

  /** Returns the number of currently idle workers. */
  get available(): number {
    return this.workers.filter((w) => !w.busy).length;
  }

  /**
   * Submit a stream for hashing.
   *
   * IMPORTANT: the caller must tee() the request body first and pass one branch here.
   * The stream is transferred to the worker (zero-copy); the caller cannot read it.
   *
   * Returns null if no workers are available (caller should return 503).
   */
  hash(stream: ReadableStream<Uint8Array>): Promise<HashResult> | null {
    const state = this.workers.find((w) => !w.busy);
    if (!state) return null; // Pool full — no queue, caller returns 503

    state.busy = true;
    const id = String(++this.jobCounter);

    const promise = new Promise<HashResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    // Transfer the stream to the worker (zero-copy handoff)
    state.worker.postMessage({ id, stream }, [
      stream as unknown as Transferable,
    ]);

    return promise;
  }

  /** Gracefully terminate all workers. */
  shutdown(): void {
    for (const { worker } of this.workers) {
      worker.terminate();
    }
    this.workers = [];
  }
}

/** Singleton pool, initialized once at startup. */
let _pool: HashWorkerPool | null = null;

export function initPool(hashWorkers: number): HashWorkerPool {
  const size = hashWorkers > 0 ? hashWorkers : navigator.hardwareConcurrency;
  _pool = new HashWorkerPool(size);
  console.log(`Hash worker pool initialized with ${size} workers.`);
  return _pool;
}

export function getPool(): HashWorkerPool {
  if (!_pool) {
    throw new Error("Worker pool not initialized. Call initPool() first.");
  }
  return _pool;
}
