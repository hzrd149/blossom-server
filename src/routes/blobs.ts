/**
 * BUD-01: GET /:sha256[.ext] and HEAD /:sha256[.ext]
 *
 * Zero-copy streaming download:
 *   storage.read(hash, ext) → ReadableStream → Response body
 *   Hono passes stream to Deno.serve() unchanged
 *   Deno.serve() pipes to TCP socket via OS async I/O
 *
 * Range requests: prefer storage.readRange() (native seek/S3 Range header),
 * fall back to stream-slicing when the adapter does not implement readRange().
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { IBlobStorage } from "../storage/interface.ts";
import { getBlob, touchBlob } from "../db/blobs.ts";
import { optionalAuth } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { Config } from "../config/schema.ts";
import { mimeToExt } from "../utils/mime.ts";

const SHA256_RE = /^[0-9a-f]{64}$/;

export function buildBlobsRouter(
  db: Client,
  storage: IBlobStorage,
  _config: Config,
): Hono {
  const app = new Hono();

  // GET /:sha256 and GET /:sha256.ext
  // HEAD /:sha256 and HEAD /:sha256.ext
  // Match the full segment including optional extension (e.g. abc123...def.jpg)
  app.on(["GET", "HEAD"], "/:filename", async (ctx, next) => {
    const filename = ctx.req.param("filename") ?? "";
    // Extract 64-char hex hash — the last 64-char hex run in the segment
    const match = filename.match(/([0-9a-f]{64})/);
    const hash = match?.[1] ?? "";

    if (!SHA256_RE.test(hash)) {
      return next();
    }

    // Optional auth enforcement for private blobs (config-gated, not implemented in v1)
    // BUD-11: servers MAY require auth for GET — we make it configurable
    // For now: if requireAuth is set on upload, GET is public (common case)
    // Future: add config.get.requireAuth
    const _auth = optionalAuth(ctx);

    // Lookup metadata — DB is the index; type column tells us the on-disk extension
    const blob = await getBlob(db, hash);
    if (!blob) {
      return errorResponse(ctx, 404, "Blob not found");
    }

    // Derive the extension the file was stored with
    const ext = mimeToExt(blob.type);

    // Check storage has the actual file
    if (!(await storage.has(hash, ext))) {
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
      "ETag": `"${hash}"`,
      "Last-Modified": new Date(blob.uploaded * 1000).toUTCString(),
    };

    // Conditional request: If-None-Match (RFC 9110 §13.1.2)
    // The SHA-256 hash is a perfect ETag — content-addressed, immutable, already computed.
    // Short-circuit before storage I/O: only the DB lookup has occurred at this point.
    const ifNoneMatch = ctx.req.header("if-none-match");
    if (ifNoneMatch) {
      const tags = ifNoneMatch.split(",").map((t) => t.trim().replace(/^"(.*)"$/, "$1"));
      if (tags.includes(hash) || tags.includes("*")) {
        return ctx.body(null, 304, {
          "ETag": headers["ETag"],
          "Cache-Control": headers["Cache-Control"],
          "Last-Modified": headers["Last-Modified"],
        });
      }
    }

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
      const stream = await readRange(storage, hash, ext, start, end);
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
    const stream = await storage.read(hash, ext);
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
 *
 * Prefers the storage adapter's native readRange() when available:
 *   - LocalStorage: Deno.open + file.seek(start) — zero bytes wasted before start
 *   - S3Storage: getPartialObject issues a Range header directly to S3
 *
 * Falls back to stream-slicing over the full read() stream when readRange()
 * is not implemented (e.g. a custom IBlobStorage that only provides the base interface).
 */
async function readRange(
  storage: IBlobStorage,
  hash: string,
  ext: string,
  start: number,
  end: number,
): Promise<ReadableStream<Uint8Array> | null> {
  // Prefer native range support when available
  if (storage.readRange) {
    return storage.readRange(hash, ext, start, end);
  }

  // Fallback: stream-slice the full blob
  const fullStream = await storage.read(hash, ext);
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
