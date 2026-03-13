/**
 * BUD-01: GET /:sha256[.ext] and HEAD /:sha256[.ext]
 *
 * Zero-copy streaming download:
 *   storage.read(hash) → ReadableStream → Response body
 *   Hono passes stream to Deno.serve() unchanged
 *   Deno.serve() pipes to TCP socket via OS async I/O
 *
 * Range requests: delegated to the OS / Deno's file.readable with seek support.
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { IBlobStorage } from "../storage/interface.ts";
import { getBlob, touchBlob } from "../db/blobs.ts";
import { optionalAuth, requireAuth } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { Config } from "../config/schema.ts";

const SHA256_RE = /^[0-9a-f]{64}$/;

export function buildBlobsRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono {
  const app = new Hono();

  // GET /:sha256 and GET /:sha256.ext
  // HEAD /:sha256 and HEAD /:sha256.ext
  // Match the full segment including optional extension (e.g. abc123...def.jpg)
  app.on(["GET", "HEAD"], "/:filename", async (ctx) => {
    const filename = ctx.req.param("filename") ?? "";
    // Extract 64-char hex hash — the last 64-char hex run in the segment
    const match = filename.match(/([0-9a-f]{64})/);
    const hash = match?.[1] ?? "";

    if (!SHA256_RE.test(hash)) {
      return errorResponse(ctx, 400, "Invalid sha256 hash");
    }

    // Optional auth enforcement for private blobs (config-gated, not implemented in v1)
    // BUD-11: servers MAY require auth for GET — we make it configurable
    // For now: if requireAuth is set on upload, GET is public (common case)
    // Future: add config.get.requireAuth
    const _auth = optionalAuth(ctx);

    // Lookup metadata
    const blob = await getBlob(db, hash);
    if (!blob) {
      return errorResponse(ctx, 404, "Blob not found");
    }

    // Check storage has the actual file
    if (!(await storage.has(hash))) {
      return errorResponse(ctx, 404, "Blob not found in storage");
    }

    // Update last-access timestamp (for prune rules) — fire-and-forget
    const now = Math.floor(Date.now() / 1000);
    touchBlob(db, hash, now).catch((err) =>
      console.warn("touchBlob failed:", err)
    );

    const mimeType = blob.type ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Content-Length": String(blob.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    if (ctx.req.method === "HEAD") {
      return ctx.body(null, 200, headers);
    }

    // Range request support (BUD-01)
    const rangeHeader = ctx.req.header("range");
    if (rangeHeader) {
      const rangeResult = parseRange(rangeHeader, blob.size);
      if (!rangeResult) {
        return ctx.body(null, 416, {
          "Content-Range": `bytes */${blob.size}`,
        });
      }

      const { start, end } = rangeResult;
      const stream = await readRange(storage, hash, start, end);
      if (!stream) return errorResponse(ctx, 404, "Blob not found in storage");

      return new Response(stream, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${blob.size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }

    // Full blob stream — zero-copy
    const stream = await storage.read(hash);
    if (!stream) return errorResponse(ctx, 404, "Blob not found in storage");

    return new Response(stream, { status: 200, headers });
  });

  return app;
}

/** Parse a Range: bytes=start-end header. Returns null for unsatisfiable ranges. */
export function parseRange(
  header: string,
  totalSize: number,
): { start: number; end: number } | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  let start = match[1] ? parseInt(match[1], 10) : NaN;
  let end = match[2] ? parseInt(match[2], 10) : NaN;

  if (isNaN(start) && isNaN(end)) return null;

  if (isNaN(start)) {
    // Suffix range: bytes=-500 → last 500 bytes
    start = totalSize - end;
    end = totalSize - 1;
  } else if (isNaN(end)) {
    // Open range: bytes=500- → from byte 500 to end
    end = totalSize - 1;
  }

  if (start < 0 || end >= totalSize || start > end) return null;
  return { start, end };
}

/**
 * Read a byte range from storage.
 * For local storage: uses Deno file seek for efficient partial reads.
 * For S3: falls back to reading the full stream and slicing (S3 supports Range natively via fetch).
 */
async function readRange(
  storage: IBlobStorage,
  hash: string,
  start: number,
  end: number,
): Promise<ReadableStream<Uint8Array> | null> {
  // The storage interface returns the full stream; we slice it here.
  // A future optimization: LocalStorage can seek to start and read (end-start+1) bytes.
  const fullStream = await storage.read(hash);
  if (!fullStream) return null;

  let bytesSkipped = 0;
  let bytesRead = 0;
  const length = end - start + 1;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = fullStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          // Skip bytes before start
          if (bytesSkipped < start) {
            const remaining = start - bytesSkipped;
            if (value.byteLength <= remaining) {
              bytesSkipped += value.byteLength;
              continue;
            }
            // Partial skip
            const slice = value.subarray(remaining);
            bytesSkipped = start;
            const toRead = Math.min(slice.byteLength, length - bytesRead);
            controller.enqueue(slice.subarray(0, toRead));
            bytesRead += toRead;
          } else {
            const toRead = Math.min(value.byteLength, length - bytesRead);
            controller.enqueue(value.subarray(0, toRead));
            bytesRead += toRead;
          }

          if (bytesRead >= length) break;
        }
      } finally {
        reader.cancel().catch(() => {});
        controller.close();
      }
    },
  });
}
