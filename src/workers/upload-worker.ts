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
 * DB connection is set up at init depending on the mode sent by the pool:
 *
 *   dbMode: "local"  — receives a MessagePort (DbProxy over MessageChannel).
 *                      Main thread holds the real Client; this worker proxies
 *                      through it. Required because SQLite file handles cannot
 *                      cross V8 isolate boundaries.
 *
 *   dbMode: "remote" — receives dbUrl + dbAuthToken and constructs its own
 *                      DirectDbHandle wrapping a real libSQL Client. No
 *                      MessageChannel overhead — each worker talks to the
 *                      remote DB server directly.
 *
 * Worker code below the init handler is identical in both modes: it only
 * ever calls methods on IDbHandle and never inspects which implementation
 * is underneath.
 *
 * Message protocol:
 *   IN  (once at init, local):  { type: "init", dbMode: "local", dbPort: MessagePort }
 *   IN  (once at init, remote): { type: "init", dbMode: "remote", dbUrl: string, dbAuthToken?: string }
 *   IN  (per upload):           { type: "job", id, stream, tmpPath, sizeHint, xSha256 }
 *   OUT (per upload):           { id, hash, size }   on success
 *                               { id, error }         on failure
 */

import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { DbProxy } from "../db/proxy.ts";
import { DirectDbHandle } from "../db/direct.ts";
import { createClient } from "@libsql/client";
import type { IDbHandle } from "../db/handle.ts";

// ---------------------------------------------------------------------------
// Worker state (persists across jobs)
// ---------------------------------------------------------------------------

let db: IDbHandle | null = null;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface InitMessageLocal {
  type: "init";
  dbMode: "local";
  dbPort: MessagePort;
}

interface InitMessageRemote {
  type: "init";
  dbMode: "remote";
  dbUrl: string;
  dbAuthToken?: string;
}

type InitMessage = InitMessageLocal | InitMessageRemote;

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
    if (msg.dbMode === "local") {
      // SQLite: proxy all DB calls through the main thread via MessageChannel
      db = new DbProxy(msg.dbPort);
    } else {
      // Remote libSQL: open a direct connection inside this isolate
      const client = createClient({ url: msg.dbUrl, authToken: msg.dbAuthToken });
      db = new DirectDbHandle(client);
    }
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
