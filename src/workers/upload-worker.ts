/// <reference lib="deno.worker" />
/**
 * Upload Worker — runs in a dedicated Deno Worker (separate V8 isolate).
 *
 * Owns the full upload I/O pipeline in a single pass:
 *   stream → [size counter | SHA-256 accumulator] → file.writable
 *
 * The hash is computed incrementally using a TransformStream that accumulates
 * chunks, then calls @std/crypto.subtle.digest once all bytes have been
 * written to disk. No tee(), no double-buffering — one read, one write.
 *
 * DB access is available via DbProxy over a persistent MessageChannel
 * (port2 transferred at pool init). Workers call db.hasBlob() etc. with
 * the same API as main-thread src/db/blobs.ts. For the core upload pipeline,
 * dedup and final insertBlob stay on the main thread; the proxy is
 * infrastructure for future BUD-04/05 workers.
 *
 * Message protocol:
 *   IN  (once at init): { type: "init", dbPort: MessagePort }
 *   IN  (per upload):   { type: "job", id, stream, tmpPath, sizeHint, xSha256 }
 *   OUT (per upload):   { id, hash, size }   on success
 *                       { id, error }         on failure
 */

import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { DbProxy } from "../db/proxy.ts";

// ---------------------------------------------------------------------------
// Worker state (persists across jobs)
// ---------------------------------------------------------------------------

// deno-lint-ignore no-unused-vars
let db: DbProxy | null = null;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface InitMessage {
  type: "init";
  dbPort: MessagePort;
}

interface JobMessage {
  type: "job";
  id: string;
  stream: ReadableStream<Uint8Array>;
  tmpPath: string;
  sizeHint: number | null;
  xSha256: string | null;
}

interface JobSuccess {
  id: string;
  hash: string;
  size: number;
}

interface JobError {
  id: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<InitMessage | JobMessage>) => {
  const msg = event.data;
  if (msg.type === "init") {
    db = new DbProxy(msg.dbPort);
    return;
  }
  if (msg.type === "job") {
    await handleJob(msg);
  }
};

// ---------------------------------------------------------------------------
// Upload pipeline — single-pass: count + accumulate + write
// ---------------------------------------------------------------------------

async function handleJob(msg: JobMessage): Promise<void> {
  const { id, stream, tmpPath, xSha256 } = msg;

  let file: Deno.FsFile | null = null;

  try {
    file = await Deno.open(tmpPath, { write: true, create: true, truncate: true });

    // Accumulate all chunks for hashing. We cannot use @std/crypto with a
    // ReadableStream that is also being piped elsewhere (tee causes deadlock
    // due to WASM digest consuming its branch without yielding). Instead we
    // collect chunks in a side buffer during the single write pass and hash
    // the completed buffer at the end. Memory cost: one copy of the blob,
    // bounded by maxUploadSize (configured on the route, default 100MB).
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    const collectingTransform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Clone the chunk before enqueueing — pipeTo takes ownership
        const copy = chunk.slice();
        chunks.push(copy);
        totalSize += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    // Single pass: stream → collectingTransform → file
    await stream.pipeThrough(collectingTransform).pipeTo(file.writable);
    file = null; // writable closed by pipeTo

    // Hash the accumulated buffer (CPU work, off main thread — that's the point)
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const hashBuffer = await stdCrypto.subtle.digest("SHA-256", combined);
    const hash = encodeHex(new Uint8Array(hashBuffer));

    // Verify against declared hash if provided
    if (xSha256 !== null && hash !== xSha256) {
      await Deno.remove(tmpPath).catch(() => {});
      self.postMessage({
        id,
        error: `Hash mismatch: declared ${xSha256}, computed ${hash}`,
      } satisfies JobError);
      return;
    }

    self.postMessage({ id, hash, size: totalSize } satisfies JobSuccess);
  } catch (err) {
    try { file?.close(); } catch { /* already closed */ }
    await Deno.remove(tmpPath).catch(() => {});
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies JobError);
  }
}
