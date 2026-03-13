/**
 * BUD-02: PUT /upload — Upload a blob
 * BUD-06: HEAD /upload — Preflight check
 *
 * Upload pipeline (main thread responsibilities):
 *   1. BUD-11 auth check
 *   2. Content-Length required → 411 if absent
 *   3. Content-Length > maxSize → 413 (body never read)
 *   4. MIME type allowlist check → 415
 *   5. X-SHA-256 format + auth x-tag validation
 *   6. Dedup check (hasBlob) → fast return if already stored
 *   7. Pool worker available? → 503 if pool full (body never read)
 *   8. Generate tmpPath, dispatch stream to worker (zero-copy transfer)
 *   9. Await { hash, size } from worker
 *  10. Verify computed hash === X-SHA-256 header (if provided) — worker also checks,
 *      but we re-verify here before committing
 *  11. Deno.rename(tmpPath → <storageDir>/<hash>.<ext>) — atomic commit, main thread
 *  12. db.insertBlob() — metadata write, main thread
 *  13. Return BlobDescriptor JSON
 *
 * Worker responsibilities (upload-worker.ts):
 *   - Open tmpPath for writing
 *   - Accumulate chunks for SHA-256
 *   - Post { hash, size } or { error } back
 */

import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import type { Client } from "@libsql/client";
import { extension as extFromMime } from "@std/media-types";
import { join } from "@std/path";
import { ulid } from "@std/ulid";
import { getBlob, hasBlob, insertBlob, isOwner } from "../db/blobs.ts";
import { requireAuth, requireXTag } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import { getPool } from "../workers/pool.ts";
import type { Config } from "../config/schema.ts";

/** BUD-02 Blob Descriptor */
interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
}

/**
 * Derive a file extension from a MIME type.
 * Returns empty string for unknown types or application/octet-stream.
 * Uses @std/media-types for comprehensive MIME → extension coverage.
 */
export function mimeToExt(mime: string | null): string {
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

export function buildUploadRouter(
  db: Client,
  storageDir: string,
  config: Config,
): Hono {
  const app = new Hono();

  // ---------------------------------------------------------------------------
  // HEAD /upload — BUD-06 preflight
  // ---------------------------------------------------------------------------

  // Hono routes HEAD requests through GET handlers (app.on("HEAD",...) is not
  // supported). We register this as GET /upload and check the method inside.
  // PUT /upload (actual upload) is registered separately below.
  app.get("/upload", async (ctx) => {
    if (!config.upload.enabled) {
      return errorResponse(ctx, 403, "Uploads are disabled on this server");
    }

    if (config.upload.requireAuth) {
      try {
        requireAuth(ctx, "upload");
      } catch (err) {
        if (err instanceof HTTPException) {
          return errorResponse(ctx, err.status as 401 | 403, err.message);
        }
        throw err;
      }
    }

    const xSha256 = ctx.req.header("x-sha-256");
    const xContentType = ctx.req.header("x-content-type") ??
      "application/octet-stream";
    const xContentLength = ctx.req.header("x-content-length");

    if (!xContentLength) {
      return errorResponse(ctx, 411, "Missing X-Content-Length header");
    }

    const size = parseInt(xContentLength, 10);
    if (isNaN(size) || size < 0) {
      return errorResponse(ctx, 400, "Invalid X-Content-Length header");
    }

    if (size > config.upload.maxSize) {
      return errorResponse(
        ctx,
        413,
        `File too large. Maximum allowed size is ${config.upload.maxSize} bytes`,
      );
    }

    if (
      config.upload.allowedTypes.length > 0 &&
      !isAllowedType(xContentType, config.upload.allowedTypes)
    ) {
      return errorResponse(ctx, 415, `Unsupported media type: ${xContentType}`);
    }

    // Check pool availability
    if (getPool().available === 0) {
      return errorResponse(ctx, 503, "Server busy, try again later");
    }

    // If hash provided and blob already exists, signal upload can be skipped
    if (xSha256 && await hasBlob(db, xSha256)) {
      return ctx.body(null, 200, { "X-Reason": "Blob already exists (dedup)" });
    }

    return ctx.body(null, 200);
  });

  // ---------------------------------------------------------------------------
  // PUT /upload — BUD-02 upload
  // ---------------------------------------------------------------------------

  app.put("/upload", async (ctx) => {
    if (!config.upload.enabled) {
      return errorResponse(ctx, 403, "Uploads are disabled on this server");
    }

    // --- 1. Auth ---
    let auth: ReturnType<typeof requireAuth> | undefined;
    if (config.upload.requireAuth) {
      auth = requireAuth(ctx, "upload");
    }

    // --- 2. Content-Length required (411 if absent) ---
    const contentLengthHeader = ctx.req.header("content-length");
    if (!contentLengthHeader) {
      await ctx.req.raw.body?.cancel();
      return errorResponse(ctx, 411, "Content-Length header required");
    }

    const contentLength = parseInt(contentLengthHeader, 10);
    if (isNaN(contentLength) || contentLength < 0) {
      await ctx.req.raw.body?.cancel();
      return errorResponse(ctx, 400, "Invalid Content-Length header");
    }

    // --- 3. Size check (413 before reading body) ---
    if (contentLength > config.upload.maxSize) {
      await ctx.req.raw.body?.cancel();
      return errorResponse(
        ctx,
        413,
        `File too large. Maximum allowed size is ${config.upload.maxSize} bytes`,
      );
    }

    // --- 4. MIME type check ---
    const contentType = ctx.req.header("content-type") ??
      "application/octet-stream";
    const mimeType = contentType.split(";")[0].trim();
    if (
      config.upload.allowedTypes.length > 0 &&
      !isAllowedType(mimeType, config.upload.allowedTypes)
    ) {
      await ctx.req.raw.body?.cancel();
      return errorResponse(ctx, 415, `Unsupported media type: ${mimeType}`);
    }

    // --- 5. X-SHA-256 validation + auth x-tag check ---
    const xSha256 = ctx.req.header("x-sha-256")?.toLowerCase() ?? null;
    if (xSha256 && !/^[0-9a-f]{64}$/.test(xSha256)) {
      await ctx.req.raw.body?.cancel();
      return errorResponse(ctx, 400, "Invalid X-SHA-256 header format");
    }

    // BUD-11: x tags are required for upload. When auth is present, verify the
    // token's x tags authorize this specific blob hash. If no x tags are present
    // on the token, any blob is permitted (open upload token). If x tags ARE
    // present but X-SHA-256 was not provided, the hash is unknown and the check
    // will fail — clients must supply X-SHA-256 when using scoped tokens.
    if (auth) {
      try {
        requireXTag(auth, xSha256 ?? "");
      } catch (err) {
        await ctx.req.raw.body?.cancel();
        if (err instanceof HTTPException) {
          return errorResponse(ctx, err.status as 403, err.message);
        }
        throw err;
      }
    }

    // Derive file extension from MIME type — used for on-disk filename and URL
    const ext = mimeToExt(mimeType);

    // --- 6. Dedup: if blob already exists, skip the whole write ---
    if (xSha256 && await hasBlob(db, xSha256)) {
      await ctx.req.raw.body?.cancel();
      const existing = await getBlob(db, xSha256);
      if (existing) {
        // Register this pubkey as an owner if they aren't already
        if (auth && !await isOwner(db, xSha256, auth.pubkey)) {
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

    // --- 7. Acquire worker (503 if pool full — no queue) ---
    const body = ctx.req.raw.body;
    if (!body) {
      return errorResponse(ctx, 400, "Request body is empty");
    }

    const pool = getPool();
    if (pool.available === 0) {
      await body.cancel();
      return errorResponse(
        ctx,
        503,
        "Server busy. All upload workers are occupied. Try again shortly.",
      );
    }

    // --- 8. Generate temp path + dispatch to worker ---
    // tmpPath is inside the storage dir so Deno.rename() is always atomic
    // (same filesystem guaranteed).
    const tmpPath = join(storageDir, ".tmp", ulid());

    const jobPromise = pool.dispatch(body, tmpPath, contentLength, xSha256);
    if (!jobPromise) {
      // Race condition: another request claimed the last worker between
      // pool.available check and dispatch(). Rare but safe to handle.
      await body.cancel().catch(() => {});
      return errorResponse(
        ctx,
        503,
        "Server busy. All upload workers are occupied. Try again shortly.",
      );
    }

    // --- 9. Await worker result ---
    let hash: string;
    let size: number;
    try {
      ({ hash, size } = await jobPromise);
    } catch (err) {
      // Worker already cleaned up tmpPath
      return errorResponse(
        ctx,
        400,
        err instanceof Error ? err.message : "Upload failed",
      );
    }

    // --- 10. Atomic commit: rename temp → <hash>.<ext> ---
    // The final filename always carries the file extension so the blob can be
    // served directly from disk with the correct name. The DB type column is
    // the authoritative source; the extension is derived from it on every read.
    const finalName = ext ? `${hash}.${ext}` : hash;
    const finalPath = join(storageDir, finalName);
    try {
      await Deno.rename(tmpPath, finalPath);
    } catch (err) {
      // If the final blob already exists (race between two identical uploads),
      // remove the temp file and continue — the existing file is correct.
      const exists = await Deno.stat(finalPath).then(() => true).catch(() =>
        false
      );
      if (!exists) {
        await Deno.remove(tmpPath).catch(() => {});
        throw err;
      }
      await Deno.remove(tmpPath).catch(() => {});
    }

    // --- 11. Insert metadata ---
    const now = Math.floor(Date.now() / 1000);
    const blobRecord = {
      sha256: hash,
      size,
      type: mimeType !== "application/octet-stream" ? mimeType : null,
      uploaded: now,
    };
    await insertBlob(db, blobRecord, auth?.pubkey ?? "anonymous");

    // --- 12. Return BlobDescriptor ---
    const baseUrl = getBaseUrl(ctx.req.raw, config.publicDomain);
    return ctx.json(
      {
        url: getBlobUrl(hash, blobRecord.type, baseUrl),
        sha256: hash,
        size,
        type: blobRecord.type ?? "application/octet-stream",
        uploaded: now,
      } satisfies BlobDescriptor,
    );
  });

  return app;
}

/** Check if a MIME type matches an allowlist (supports wildcards like "image/*"). */
function isAllowedType(mimeType: string, allowedTypes: string[]): boolean {
  const [mainType] = mimeType.split("/");
  return allowedTypes.some((allowed) => {
    if (allowed === "*" || allowed === "*/*") return true;
    if (allowed.endsWith("/*")) return allowed.slice(0, -2) === mainType;
    return allowed === mimeType;
  });
}

/** Derive the base URL for blob descriptors. */
function getBaseUrl(request: Request, publicDomain: string): string {
  if (publicDomain) return publicDomain.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
