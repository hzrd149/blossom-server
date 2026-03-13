/**
 * BUD-02: PUT /upload — Upload a blob
 * BUD-06: HEAD /upload — Preflight check
 *
 * Upload pipeline:
 *   1. Auth check (BUD-11, t=upload)
 *   2. Content-Length required → 411 if absent
 *   3. Content-Length > maxSize → 413 (body never read)
 *   4. MIME type check if allowedTypes configured → 415
 *   5. Pool worker available? → 503 if pool full (body never read)
 *   6. Dedup check (HEAD before write) → return existing descriptor if already stored
 *   7. req.body.tee() → [hashBranch → worker] + [diskBranch → storage.beginWrite()]
 *   8. Both drain concurrently via Promise.all
 *   9. Verify computed hash === X-SHA-256 header (if provided)
 *  10. storage.commitWrite() → atomic rename
 *  11. db.insertBlob() → record + owner
 *  12. Return BlobDescriptor JSON
 */

import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import type { Client } from "@libsql/client";
import type { IBlobStorage } from "../storage/interface.ts";
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

function getBlobUrl(hash: string, mimeType: string | null, baseUrl: string): string {
  const ext = mimeToExt(mimeType);
  return `${baseUrl}/${hash}${ext ? `.${ext}` : ""}`;
}

/** Rough MIME → extension mapping for BUD-02 URL requirement. */
function mimeToExt(mime: string | null): string {
  if (!mime) return "";
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/json": "json",
    "text/plain": "txt",
    "text/html": "html",
    "application/zip": "zip",
    "application/octet-stream": "",
  };
  return map[mime.split(";")[0].trim()] ?? "";
}

export function buildUploadRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono {
  const app = new Hono();

  /**
   * HEAD /upload — BUD-06 preflight check.
   * Client sends X-SHA-256, X-Content-Type, X-Content-Length headers.
   * Server responds with 200 OK or an error explaining why upload would fail.
   */
  app.on("HEAD", "/upload", async (ctx) => {
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

    const xSha256 = ctx.req.header("x-sha256");
    const xContentType = ctx.req.header("x-content-type") ?? "application/octet-stream";
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
    const pool = getPool();
    if (pool.available === 0) {
      return errorResponse(ctx, 503, "Server busy, try again later");
    }

    // If hash provided and blob already exists, signal that upload can skip
    if (xSha256 && await hasBlob(db, xSha256)) {
      return ctx.body(null, 200, { "X-Reason": "Blob already exists (dedup)" });
    }

    return ctx.body(null, 200);
  });

  /**
   * PUT /upload — Upload a blob (BUD-02).
   */
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
    const contentType = ctx.req.header("content-type") ?? "application/octet-stream";
    const mimeType = contentType.split(";")[0].trim();
    if (
      config.upload.allowedTypes.length > 0 &&
      !isAllowedType(mimeType, config.upload.allowedTypes)
    ) {
      await ctx.req.raw.body?.cancel();
      return errorResponse(ctx, 415, `Unsupported media type: ${mimeType}`);
    }

    // --- 5. Acquire worker (503 if pool full — no queue) ---
    const pool = getPool();
    const xSha256 = ctx.req.header("x-sha256")?.toLowerCase();

    // Validate x-sha256 header format if provided
    if (xSha256 && !/^[0-9a-f]{64}$/.test(xSha256)) {
      await ctx.req.raw.body?.cancel();
      return errorResponse(ctx, 400, "Invalid X-SHA-256 header format");
    }

    // BUD-11: if x tags present in auth, verify the claimed hash is authorized
    if (auth && xSha256) {
      try {
        requireXTag(auth, xSha256);
      } catch (err) {
        await ctx.req.raw.body?.cancel();
        if (err instanceof HTTPException) {
          return errorResponse(ctx, err.status as 403, err.message);
        }
        throw err;
      }
    }

    // --- 6. Dedup: if blob already exists, skip storage write ---
    if (xSha256 && await hasBlob(db, xSha256)) {
      await ctx.req.raw.body?.cancel();
      const existing = await getBlob(db, xSha256);
      if (existing && auth) {
        // Register this pubkey as an owner too (re-upload)
        if (!await isOwner(db, xSha256, auth.pubkey)) {
          await insertBlob(db, existing, auth.pubkey);
        }
      }
      if (existing) {
        const baseUrl = getBaseUrl(ctx.req.raw, config.publicDomain);
        const descriptor: BlobDescriptor = {
          url: getBlobUrl(existing.sha256, existing.type, baseUrl),
          sha256: existing.sha256,
          size: existing.size,
          type: existing.type ?? "application/octet-stream",
          uploaded: existing.uploaded,
        };
        return ctx.json(descriptor, 200);
      }
    }

    // --- 5b. Pool availability check (after dedup to avoid unnecessary 503s) ---
    const body = ctx.req.raw.body;
    if (!body) {
      return errorResponse(ctx, 400, "Request body is empty");
    }

    // Tee the stream: one branch to hash worker, one to disk
    const [hashBranch, diskBranch] = body.tee();

    const hashPromise = pool.hash(hashBranch);
    if (!hashPromise) {
      // Cancel both branches — no worker available
      await hashBranch.cancel().catch(() => {});
      await diskBranch.cancel().catch(() => {});
      return errorResponse(
        ctx,
        503,
        "Server busy. All upload workers are occupied. Try again shortly.",
      );
    }

    // --- 7. Begin storage write with the disk branch ---
    const session = await storage.beginWrite(contentLength);

    let computedHash: string;
    let computedSize: number;

    try {
      // Pipe disk branch to storage — zero-copy async I/O
      const pipePromise = diskBranch.pipeTo(session.writable);

      // Both drain concurrently
      const [hashResult] = await Promise.all([hashPromise, pipePromise]);

      computedHash = hashResult.hash;
      computedSize = hashResult.size;
    } catch (err) {
      await storage.abortWrite(session).catch(() => {});
      throw err;
    }

    // --- 9. Verify hash if X-SHA-256 was provided ---
    if (xSha256 && computedHash !== xSha256) {
      await storage.abortWrite(session);
      return errorResponse(
        ctx,
        400,
        `Hash mismatch: declared ${xSha256}, computed ${computedHash}`,
      );
    }

    // --- 10. Atomic commit ---
    await storage.commitWrite(session, computedHash);

    // --- 11. Insert metadata ---
    const now = Math.floor(Date.now() / 1000);
    const blobRecord = {
      sha256: computedHash,
      size: computedSize,
      type: mimeType !== "application/octet-stream" ? mimeType : null,
      uploaded: now,
    };
    await insertBlob(db, blobRecord, auth?.pubkey ?? "anonymous");

    // --- 12. Return BlobDescriptor ---
    const baseUrl = getBaseUrl(ctx.req.raw, config.publicDomain);
    const descriptor: BlobDescriptor = {
      url: getBlobUrl(computedHash, blobRecord.type, baseUrl),
      sha256: computedHash,
      size: computedSize,
      type: blobRecord.type ?? "application/octet-stream",
      uploaded: now,
    };

    return ctx.json(descriptor, 200);
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
  if (publicDomain) {
    return publicDomain.replace(/\/$/, "");
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
