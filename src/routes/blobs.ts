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
import type { BlossomVariables } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { Config } from "../config/schema.ts";
import { mimeToExt } from "../utils/mime.ts";

/**
 * A valid blob path segment: exactly the 64-char hash with an optional short
 * alphanumeric extension. Deliberately strict — a segment that carries URL
 * slop (e.g. event JSON glued onto the hash by a misbehaving client) must
 * fall through to 404 rather than fuzzy-match the leading hex run.
 */
const BLOB_SEGMENT_RE = /^([0-9a-f]{64})(?:\.[A-Za-z0-9]{1,10})?$/;

/** Extract the blob hash from a /:filename segment, or null if it is not a
 * strict `<sha256>[.ext]` reference. */
export function extractBlobHash(filename: string): string | null {
  const match = filename.match(BLOB_SEGMENT_RE);
  return match ? match[1] : null;
}

export function buildBlobsRouter(
  db: Client,
  storage: IBlobStorage,
  _config: Config,
): Hono<{ Variables: BlossomVariables }> {
  const app = new Hono<{ Variables: BlossomVariables }>();

  // GET /:sha256 and GET /:sha256.ext
  // HEAD /:sha256 and HEAD /:sha256.ext
  // Match the full segment including optional extension (e.g. abc123...def.jpg)
  app.on(["GET", "HEAD"], "/:filename", async (ctx, next) => {
    const filename = ctx.req.param("filename") ?? "";
    const hash = extractBlobHash(filename);

    if (!hash) {
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

    const ext = mimeToExt(blob.type);

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
      ETag: `"${hash}"`,
      "Last-Modified": new Date(blob.uploaded * 1000).toUTCString(),
    };

    // Conditional request: If-None-Match (RFC 9110 §13.1.2)
    // The SHA-256 hash is a perfect ETag — content-addressed, immutable, already computed.
    // Short-circuit before storage I/O: only the DB lookup has occurred at this point.
    const ifNoneMatch = ctx.req.header("if-none-match");
    if (ifNoneMatch) {
      const tags = ifNoneMatch.split(",").map((t) =>
        t.trim().replace(/^"(.*)"$/, "$1")
      );
      if (tags.includes(hash) || tags.includes("*")) {
        return ctx.body(null, 304, {
          ETag: headers["ETag"],
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

/**
 * Parse a `Range: bytes=start-end` header. Returns null for unsatisfiable ranges.
 *
 * Per RFC 9110 §14.1.2, a last-byte-pos at or beyond the end of the
 * representation is clamped to the last byte rather than rejected, and a
 * suffix-length longer than the representation selects the whole thing. Only a
 * first-byte-pos at or past the end makes a range unsatisfiable.
 *
 * Clamping is what lets range-slicing caches work. nginx's slice module, for
 * one, asks for fixed-size aligned slices (`bytes=1048576-2097151`), so the
 * final slice of any file that isn't an exact multiple of the slice size always
 * runs past EOF. Answering 416 there makes the cache abort mid-file and hand
 * the client a truncated body.
 */
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
    // Suffix range: bytes=-500 → last 500 bytes. A suffix-length of 0 selects
    // nothing and is unsatisfiable; one longer than the file selects all of it.
    if (end === 0) return null;
    start = Math.max(0, totalSize - end);
    end = totalSize - 1;
  } else if (isNaN(end)) {
    // Open range: bytes=500- → from byte 500 to end
    end = totalSize - 1;
  } else if (end >= totalSize) {
    // Explicit range running past EOF → clamp to the last byte
    end = totalSize - 1;
  }

  if (start >= totalSize || start > end) return null;
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
