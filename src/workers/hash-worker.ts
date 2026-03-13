/// <reference lib="deno.worker" />
/**
 * Hash Worker — runs in a dedicated Deno Worker (separate V8 isolate).
 *
 * Receives a transferred ReadableStream from the main thread, computes
 * SHA-256 using @std/crypto's streaming digest (chunk-by-chunk, zero buffering),
 * and posts the result back.
 *
 * Message protocol:
 *   IN:  { id: string, stream: ReadableStream<Uint8Array> }  (stream is transferred)
 *   OUT: { id: string, hash: string, size: number }          on success
 *        { id: string, error: string }                        on failure
 */

import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";

interface HashRequest {
  id: string;
  stream: ReadableStream<Uint8Array>;
}

interface HashResult {
  id: string;
  hash: string;
  size: number;
}

interface HashError {
  id: string;
  error: string;
}

self.onmessage = async (event: MessageEvent<HashRequest>) => {
  const { id, stream } = event.data;

  try {
    // Track size via a TransformStream passthrough counter
    let totalSize = 0;
    const countingStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        totalSize += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    // @std/crypto accepts a ReadableStream and hashes chunk-by-chunk.
    // This is a true streaming incremental SHA-256 — no full-body buffering.
    const counted = stream.pipeThrough(countingStream);
    // @std/crypto.subtle.digest accepts AsyncIterable<BufferSource> at runtime.
    // The Uint8Array<ArrayBufferLike> type mismatch is a lib.d.ts overstrictness;
    // double-cast through unknown to satisfy the type checker.
    // deno-lint-ignore no-explicit-any
    const hashBuffer = await stdCrypto.subtle.digest("SHA-256", counted as any);
    const hash = encodeHex(new Uint8Array(hashBuffer));

    self.postMessage({ id, hash, size: totalSize } satisfies HashResult);
  } catch (err) {
    self.postMessage(
      {
        id,
        error: err instanceof Error ? err.message : String(err),
      } satisfies HashError,
    );
  }
};
