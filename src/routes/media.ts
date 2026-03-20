/**
 * BUD-05: PUT /media — Upload and optimize a media blob
 *         HEAD /media — Preflight check (BUD-06 style)
 *
 * Key differences from PUT /upload:
 *   - Auth verb is "media" (not "upload")
 *   - Body is written to a temp file, then optimized/transcoded before storage
 *   - Stored blob is the *optimized* derivative, not the original
 *   - Returned hash is the hash of the *optimized* output
 *   - x-tag verification is STRICT and POST-BODY (original hash must be in x tags)
 *   - Dedup short-circuit via media_derivatives table (original → optimized mapping)
 *
 * PUT /media pipeline:
 *  1.  config.media.enabled → 403
 *  2.  config.media.requireAuth → requireAuth(ctx, "media") → 401/403
 *  3.  Content-Length required → 411 (cancel body)
 *  4.  Content-Length > config.media.maxSize → 413 (cancel body)
 *  5.  Content-Type MIME allowlist check → 415 (cancel body)
 *  6.  X-SHA-256 header format check → 400 (cancel body)
 *  7.  Pool availability → 503 (cancel body)
 *  8.  Generate tmpPath, dispatch stream to worker
 *  9.  Await { hash: originalHash, size } from worker
 * 10.  Strict x-tag check against originalHash (required for /media)
 * 11.  Short-circuit dedup: getMediaDerivative(originalHash) → return existing
 * 12.  optimizeMedia(tmpPath, config.media) → optimizedTmpPath
 * 13.  Remove original tmpPath
 * 14.  Re-hash optimizedTmpPath → optimizedHash + optimizedSize
 * 15.  Detect MIME of optimized output
 * 16.  Dedup: hasBlob(optimizedHash) → rename done elsewhere, add owner + mapping
 * 17.  Atomic rename optimizedTmpPath → <storageDir>/<optimizedHash>[.<ext>]
 * 18.  insertBlob() + insertMediaDerivative()
 * 19.  Return BlobDescriptor JSON
 */

import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import type { Client } from "@libsql/client";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { typeByExtension } from "@std/media-types";
import { extension as extFromMime } from "@std/media-types";
import { ulid } from "@std/ulid";
import {
  getBlob,
  getMediaDerivative,
  hasBlob,
  insertBlob,
  insertMediaDerivative,
  isOwner,
} from "../db/blobs.ts";
import { requireAuth } from "../middleware/auth.ts";
import type { BlossomVariables } from "../middleware/auth.ts";
import { debug } from "../middleware/debug.ts";
import { errorResponse } from "../middleware/errors.ts";
import { optimizeMedia } from "../optimize/index.ts";
import { getFileRule } from "../prune/rules.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import { getPool } from "../workers/pool.ts";
import type { Config } from "../config/schema.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** BUD-02 Blob Descriptor */
interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors upload.ts — kept local for route self-containment)
// ---------------------------------------------------------------------------

function mimeToExt(mime: string | null): string {
  if (!mime || mime === "application/octet-stream") return "";
  return extFromMime(mime) ?? "";
}

function getBlobUrl(
  hash: string,
  mimeType: string | null,
  baseUrl: string,
): string {
  const ext = mimeToExt(mimeType);
  return `${baseUrl}/${hash}${ext ? `.${ext}` : ""}`;
}

function getBaseUrl(request: Request, publicDomain: string): string {
  if (publicDomain) return publicDomain.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Compute SHA-256 and total byte size of a file by streaming it in chunks.
 * Uses stdCrypto.subtle.digest() with a ReadableStream — no full-file allocation.
 * The stream is tee()'d so we can count bytes via a TransformStream and hash simultaneously.
 */
async function hashFile(
  filePath: string,
): Promise<{ hash: string; size: number }> {
  const file = await Deno.open(filePath, { read: true });
  const [s1, s2] = file.readable.tee();

  let size = 0;
  const countingTransform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  // Drain s2 through counting transform (discard output), hash s1 concurrently
  const [hashBuf] = await Promise.all([
    stdCrypto.subtle.digest(
      "SHA-256",
      s1 as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>,
    ),
    s2.pipeThrough(countingTransform).pipeTo(new WritableStream()),
  ]);

  return { hash: encodeHex(new Uint8Array(hashBuf)), size };
}

/**
 * Detect MIME type of the optimized output from its file extension.
 * Falls back to "application/octet-stream" if the extension is unknown.
 */
function detectOptimizedMime(filePath: string): string {
  const dotExt = filePath.match(/\.([^.]+)$/)?.[1];
  if (!dotExt) return "application/octet-stream";
  return typeByExtension(dotExt) ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function buildMediaRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono<{ Variables: BlossomVariables }> {
  const app = new Hono<{ Variables: BlossomVariables }>();

  // -------------------------------------------------------------------------
  // HEAD /media — BUD-06-style preflight
  // -------------------------------------------------------------------------

  // Hono does not support HEAD-only routes directly; register as GET and
  // the framework strips the body automatically for HEAD requests.
  app.get("/media", (ctx) => {
    // --- 1. Feature flag ---
    if (!config.media.enabled) {
      return errorResponse(
        ctx,
        403,
        "Media endpoint is disabled on this server",
      );
    }

    // --- 2. Auth ---
    if (config.media.requireAuth) {
      try {
        requireAuth(ctx, "media");
      } catch (err) {
        if (err instanceof HTTPException) {
          return errorResponse(ctx, err.status as 401 | 403, err.message);
        }
        throw err;
      }
    }

    // --- 3. Pool availability ---
    if (getPool().available === 0) {
      return errorResponse(
        ctx,
        503,
        "Server busy. All upload workers are occupied. Try again shortly.",
      );
    }

    return ctx.body(null, 200);
  });

  // -------------------------------------------------------------------------
  // PUT /media — BUD-05 upload with optimization
  // -------------------------------------------------------------------------

  app.put("/media", async (ctx) => {
    const reqId = ulid();
    const debugPrefix = `[media:${reqId}]`;

    // Track temp paths for cleanup on error
    let tmpPath: string | null = null;
    let optimizedTmpPath: string | null = null;

    try {
      // --- 1. Feature flag ---
      if (!config.media.enabled) {
        debug(debugPrefix, "rejected: media endpoint disabled");
        return errorResponse(
          ctx,
          403,
          "Media endpoint is disabled on this server",
        );
      }

      // --- 2. Auth ---
      let auth: ReturnType<typeof requireAuth> | undefined;
      if (config.media.requireAuth) {
        try {
          auth = requireAuth(ctx, "media");
        } catch (err) {
          const msg = err instanceof HTTPException ? err.message : String(err);
          debug(debugPrefix, `rejected: auth failed — ${msg}`);
          if (err instanceof HTTPException) {
            return errorResponse(ctx, err.status as 401 | 403, err.message);
          }
          throw err;
        }
      } else {
        auth = ctx.get("auth");
      }

      debug(
        debugPrefix,
        `PUT /media — pubkey=${auth?.pubkey?.slice(0, 8) ?? "anon"}`,
      );

      // --- 3. Content-Length required ---
      const contentLengthHeader = ctx.req.header("content-length");
      if (!contentLengthHeader) {
        await ctx.req.raw.body?.cancel();
        debug(debugPrefix, "rejected: missing Content-Length");
        return errorResponse(ctx, 411, "Content-Length header required");
      }

      const contentLength = parseInt(contentLengthHeader, 10);
      if (isNaN(contentLength) || contentLength < 0) {
        await ctx.req.raw.body?.cancel();
        debug(
          debugPrefix,
          `rejected: invalid Content-Length "${contentLengthHeader}"`,
        );
        return errorResponse(ctx, 400, "Invalid Content-Length header");
      }

      // --- 4. Size check ---
      if (contentLength > config.media.maxSize) {
        await ctx.req.raw.body?.cancel();
        debug(
          debugPrefix,
          `rejected: file too large — ${contentLength} > ${config.media.maxSize} bytes`,
        );
        return errorResponse(
          ctx,
          413,
          `File too large. Maximum allowed size is ${config.media.maxSize} bytes`,
        );
      }

      // --- 5. MIME allowlist check via storage rules ---
      const contentType = ctx.req.header("content-type") ??
        "application/octet-stream";
      const mimeType = contentType.split(";")[0].trim();
      const mimeRule = getFileRule(
        { mimeType, pubkey: auth?.pubkey },
        config.storage.rules,
        config.upload.requirePubkeyInRule,
      );
      if (!mimeRule) {
        await ctx.req.raw.body?.cancel();
        debug(
          debugPrefix,
          `rejected: no storage rule matches — mime=${mimeType}`,
        );
        if (config.upload.requirePubkeyInRule) {
          return errorResponse(
            ctx,
            401,
            "Pubkey not authorized by any storage rule",
          );
        }
        return errorResponse(
          ctx,
          415,
          `Server does not accept ${mimeType} blobs`,
        );
      }

      // --- 6. X-SHA-256 header format ---
      const xSha256 = ctx.req.header("x-sha-256")?.toLowerCase() ?? null;
      if (xSha256 && !/^[0-9a-f]{64}$/.test(xSha256)) {
        await ctx.req.raw.body?.cancel();
        debug(debugPrefix, `rejected: invalid X-SHA-256 format — "${xSha256}"`);
        return errorResponse(ctx, 400, "Invalid X-SHA-256 header format");
      }

      // --- 7. Pool availability ---
      const body = ctx.req.raw.body;
      if (!body) {
        debug(debugPrefix, "rejected: empty request body");
        return errorResponse(ctx, 400, "Request body is empty");
      }

      const pool = getPool();
      if (pool.available === 0) {
        await body.cancel();
        debug(debugPrefix, "rejected: all upload workers busy");
        return errorResponse(
          ctx,
          503,
          "Server busy. All upload workers are occupied. Try again shortly.",
        );
      }

      // --- 8. Begin write session + dispatch stream to worker ---
      // beginWrite() allocates a local tmp file. For S3 this is in s3.tmpDir;
      // zero bytes reach S3 until commitFile() is called after optimization.
      const session = await storage.beginWrite(contentLength);
      tmpPath = session.tmpPath;
      debug(
        debugPrefix,
        `dispatching to worker — size=${contentLength} mime=${mimeType}`,
      );

      const jobPromise = pool.dispatch(body, tmpPath, contentLength, xSha256);
      if (!jobPromise) {
        await body.cancel().catch(() => {});
        await storage.abortWrite(session).catch(() => {});
        tmpPath = null;
        debug(
          debugPrefix,
          "rejected: worker race — all workers claimed before dispatch",
        );
        return errorResponse(
          ctx,
          503,
          "Server busy. All upload workers are occupied. Try again shortly.",
        );
      }

      // --- 9. Await worker result ---
      let originalHash: string;
      let _originalSize: number;
      try {
        ({ hash: originalHash, size: _originalSize } = await jobPromise);
        debug(
          debugPrefix,
          `worker complete — originalHash=${originalHash.slice(0, 8)}`,
        );
      } catch (err) {
        tmpPath = null; // worker already cleaned up
        const msg = err instanceof Error ? err.message : "Upload failed";
        debug(debugPrefix, `worker error — ${msg}`);
        return errorResponse(ctx, 400, msg);
      }

      // --- 10. Strict x-tag check (REQUIRED for /media, post-body) ---
      // /media always requires x tags — unlike /upload where they're optional.
      if (auth) {
        const xTags = auth.tags.filter((t) => t[0] === "x");
        if (xTags.length === 0) {
          await Deno.remove(tmpPath).catch(() => {});
          tmpPath = null;
          debug(debugPrefix, "rejected: no x tags in auth event");
          return errorResponse(
            ctx,
            403,
            "Auth event is missing required x tag for PUT /media",
          );
        }
        if (!xTags.some((t) => t[1] === originalHash)) {
          await Deno.remove(tmpPath).catch(() => {});
          tmpPath = null;
          debug(
            debugPrefix,
            `rejected: x-tag mismatch — ${originalHash.slice(0, 8)}`,
          );
          return errorResponse(
            ctx,
            403,
            `Auth token does not authorize uploading blob ${originalHash}`,
          );
        }
      }

      // --- 11. Short-circuit dedup via media_derivatives ---
      const existingOptimizedHash = await getMediaDerivative(db, originalHash);
      if (existingOptimizedHash) {
        await Deno.remove(tmpPath).catch(() => {});
        tmpPath = null;
        debug(
          debugPrefix,
          `dedup hit (derivative) — optimizedHash=${
            existingOptimizedHash.slice(0, 8)
          }`,
        );
        const existing = await getBlob(db, existingOptimizedHash);
        if (existing) {
          if (
            auth && !(await isOwner(db, existingOptimizedHash, auth.pubkey))
          ) {
            await insertBlob(db, existing, auth.pubkey);
          }
          const baseUrl = getBaseUrl(ctx.req.raw, config.publicDomain);
          return ctx.json(
            {
              url: getBlobUrl(existing.sha256, existing.type, baseUrl),
              sha256: existing.sha256,
              size: existing.size,
              type: existing.type ?? "application/octet-stream",
              uploaded: existing.uploaded,
            } satisfies BlobDescriptor,
          );
        }
        // Derivative record exists but blob was pruned — fall through to re-optimize
      }

      // --- 12. Optimize ---
      // tmpPath is guaranteed non-null here: it was assigned at step 8 and
      // cleared only in early-return branches above (worker error, x-tag fail,
      // derivative dedup return). Any early return above exits the function.
      const origTmpPath = tmpPath!;
      debug(
        debugPrefix,
        `optimizing — originalHash=${originalHash.slice(0, 8)}`,
      );
      try {
        optimizedTmpPath = await optimizeMedia(origTmpPath, config.media);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Optimization failed";
        debug(debugPrefix, `optimization error — ${msg}`);
        return errorResponse(ctx, 500, msg);
      }

      // --- 13. Remove original temp (no longer needed) ---
      await Deno.remove(origTmpPath).catch(() => {});
      tmpPath = null;

      // optimizedTmpPath is guaranteed non-null from this point (assigned in step 12)
      const optPath = optimizedTmpPath!;

      // --- 14. Re-hash the optimized output ---
      let optimizedHash: string;
      let optimizedSize: number;
      try {
        ({ hash: optimizedHash, size: optimizedSize } = await hashFile(
          optPath,
        ));
        debug(
          debugPrefix,
          `re-hash complete — optimizedHash=${
            optimizedHash.slice(0, 8)
          } size=${optimizedSize}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Hash failed";
        debug(debugPrefix, `re-hash error — ${msg}`);
        return errorResponse(
          ctx,
          500,
          `Failed to hash optimized output: ${msg}`,
        );
      }

      // --- 15. Detect MIME of optimized output ---
      const optimizedMime = detectOptimizedMime(optPath);
      const optimizedExt = mimeToExt(optimizedMime);

      // --- 16. Dedup: optimized blob already stored ---
      if (await hasBlob(db, optimizedHash)) {
        await Deno.remove(optPath).catch(() => {});
        optimizedTmpPath = null;
        debug(
          debugPrefix,
          `dedup hit (optimized blob) — ${optimizedHash.slice(0, 8)}`,
        );
        const existing = await getBlob(db, optimizedHash);
        if (existing) {
          // Record the original→optimized mapping even on dedup
          await insertMediaDerivative(db, originalHash, optimizedHash);
          if (auth && !(await isOwner(db, optimizedHash, auth.pubkey))) {
            await insertBlob(db, existing, auth.pubkey);
          }
          const baseUrl = getBaseUrl(ctx.req.raw, config.publicDomain);
          return ctx.json(
            {
              url: getBlobUrl(existing.sha256, existing.type, baseUrl),
              sha256: existing.sha256,
              size: existing.size,
              type: existing.type ?? "application/octet-stream",
              uploaded: existing.uploaded,
            } satisfies BlobDescriptor,
          );
        }
      }

      // --- 17. Commit optimized file to storage ---
      // For local: atomic rename. For S3: stream optimized file to bucket, delete local copy.
      // commitFile() handles dedup internally (no-op if blob already exists).
      try {
        await storage.commitFile(optPath, optimizedHash, optimizedExt);
      } catch (err) {
        await Deno.remove(optPath).catch(() => {});
        throw err;
      }
      optimizedTmpPath = null;

      // --- 18. Insert metadata + derivative mapping ---
      const now = Math.floor(Date.now() / 1000);
      const blobRecord = {
        sha256: optimizedHash,
        size: optimizedSize,
        type: optimizedMime !== "application/octet-stream"
          ? optimizedMime
          : null,
        uploaded: now,
      };
      await insertBlob(db, blobRecord, auth?.pubkey ?? "anonymous");
      await insertMediaDerivative(db, originalHash, optimizedHash);

      // --- 19. Return BlobDescriptor ---
      debug(
        debugPrefix,
        `media upload complete — ${optimizedHash} (${optimizedSize} bytes, ${optimizedMime})`,
      );
      const baseUrl = getBaseUrl(ctx.req.raw, config.publicDomain);
      return ctx.json(
        {
          url: getBlobUrl(optimizedHash, blobRecord.type, baseUrl),
          sha256: optimizedHash,
          size: optimizedSize,
          type: blobRecord.type ?? "application/octet-stream",
          uploaded: now,
        } satisfies BlobDescriptor,
      );
    } catch (err) {
      // Global catch: clean up any remaining temp files
      if (tmpPath) await Deno.remove(tmpPath).catch(() => {});
      if (optimizedTmpPath) await Deno.remove(optimizedTmpPath).catch(() => {});
      const msg = err instanceof Error ? err.message : "Internal server error";
      return errorResponse(ctx, 500, msg);
    }
  });

  return app;
}
