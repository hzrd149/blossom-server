/// <reference lib="deno.worker" />
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { DbProxy } from "../db/proxy.ts";
import { DirectDbHandle } from "../db/direct.ts";
import type { IDbHandle } from "../db/handle.ts";
import { BYTE_LIMIT_ERROR } from "../utils/streams.ts";

let _db: IDbHandle | null = null;

let _bytesThisWindow = 0;

interface InitMessageLocal {
  type: "init";
  dbMode: "local";
  dbPort: MessagePort;
  throughputWindowMs: number;
}

interface InitMessageRemote {
  type: "init";
  dbMode: "remote";
  dbUrl: string;
  dbAuthToken?: string;
  throughputWindowMs: number;
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

/** Discriminated error types for status code mapping on the main thread. */
type WorkerErrorType =
  | "HASH_MISMATCH"
  | "WRITE_ERROR"
  | "BYTE_LIMIT"
  | "UNKNOWN";

interface JobError {
  id: string;
  error: string;
  errorType: WorkerErrorType;
}

interface ThroughputReport {
  type: "throughput";
  bytesPerSec: number;
}

self.onmessage = async (event: MessageEvent<InitMessage | JobMessage>) => {
  const msg = event.data;
  if (msg.type === "init") {
    if (msg.dbMode === "local") {
      _db = new DbProxy(msg.dbPort);
    } else {
      const { createClient } = await import("@libsql/client");
      const client = createClient({
        url: msg.dbUrl,
        authToken: msg.dbAuthToken,
      });
      _db = new DirectDbHandle(client);
    }

    const windowMs = msg.throughputWindowMs;
    setInterval(() => {
      const bytesPerSec = Math.round(_bytesThisWindow * (1_000 / windowMs));
      _bytesThisWindow = 0;
      self.postMessage(
        { type: "throughput", bytesPerSec } satisfies ThroughputReport,
      );
    }, windowMs);

    return;
  }
  if (msg.type === "job") {
    await handleJob(msg);
  }
};

async function handleJob(msg: JobMessage): Promise<void> {
  const { id, stream, tmpPath, xSha256 } = msg;

  let file: Deno.FsFile | null = null;

  try {
    file = await Deno.open(tmpPath, {
      write: true,
      create: true,
      truncate: true,
    });

    // Split the stream into two independent branches:
    //   s1 → digest()    — consumed by the @std/crypto WASM DigestContext
    //   s2 → pipeTo()    — written to the temp file on disk
    //
    // digest("SHA-256", s1) uses the AsyncIterable branch of @std/crypto:
    //   for await (const chunk of s1) { context.update(chunk) }
    // Hash state is constant ~104 bytes; no chunk accumulation occurs.
    //
    // The size counter runs as a TransformStream on s2 so it never touches s1.
    // Both branches are driven concurrently by Promise.all(). The event loop
    // interleaves them cooperatively at every chunk boundary. Under disk
    // backpressure, the tee internal queue rate-limits s1 to match disk speed —
    // correct behaviour, not a deadlock.
    const [s1, s2] = stream.tee();

    let totalSize = 0;
    const countingTransform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        totalSize += chunk.byteLength;
        _bytesThisWindow += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    const [hashBuffer] = await Promise.all([
      stdCrypto.subtle.digest(
        "SHA-256",
        s1 as ReadableStream<Uint8Array<ArrayBuffer>>,
      ),
      s2.pipeThrough(countingTransform).pipeTo(file.writable),
    ]);
    file = null; // writable closed by pipeTo

    const hash = encodeHex(new Uint8Array(hashBuffer));

    // Verify against declared hash if provided
    if (xSha256 !== null && hash !== xSha256) {
      await Deno.remove(tmpPath).catch(() => {});
      self.postMessage(
        {
          id,
          error: `Hash mismatch: declared ${xSha256}, computed ${hash}`,
          errorType: "HASH_MISMATCH",
        } satisfies JobError,
      );
      return;
    }

    self.postMessage({ id, hash, size: totalSize } satisfies JobSuccess);
  } catch (err) {
    try {
      file?.close();
    } catch { /* already closed */ }
    await Deno.remove(tmpPath).catch(() => {});
    const errText = err instanceof Error ? err.message : String(err);
    // byteCapGuard errors carry a sentinel so routes can map them to 413
    // instead of a generic 400.
    const errorType: WorkerErrorType = errText.includes(BYTE_LIMIT_ERROR)
      ? "BYTE_LIMIT"
      : "UNKNOWN";
    self.postMessage(
      {
        id,
        error: errText,
        errorType,
      } satisfies JobError,
    );
  }
}
