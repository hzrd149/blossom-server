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
import { ulid } from "@std/ulid";
import { getBlob, hasBlob, insertBlob, isOwner } from "../db/blobs.ts";
import { requireAuth, requireXTag } from "../middleware/auth.ts";
import type { BlossomVariables } from "../middleware/auth.ts";
import { debug } from "../middleware/debug.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import { getPool } from "../workers/pool.ts";
import type { Config } from "../config/schema.ts";
import { mimeToExt } from "../utils/mime.ts";
import { getBaseUrl, getBlobUrl } from "../utils/url.ts";
import { getFileRule } from "../prune/rules.ts";

/** BUD-02 Blob Descriptor */
interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
}

export function buildUploadRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono<{ Variables: BlossomVariables }> {
  const app = new Hono<{ Variables: BlossomVariables }>();

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

    // --- Storage rule check (preflight) ---
    // storage.rules is the upload gate. auth may not be populated for HEAD
    // (auth is optional in preflight), so pass pubkey only when available.
    const preflightPubkey = ctx.get("auth")?.pubkey;
    const rule = getFileRule(
      { mimeType: xContentType, pubkey: preflightPubkey },
      config.storage.rules,
      config.upload.requirePubkeyInRule,
    );
    if (!rule) {
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
        `Server does not accept ${xContentType} blobs`,
      );
    }

    // Check pool availability
    if (getPool().available === 0) {
      return errorResponse(ctx, 503, "Server busy, try again later");
    }

    // If hash provided and blob already exists, signal upload can be skipped
    if (xSha256 && (await hasBlob(db, xSha256))) {
      return ctx.body(null, 200, { "X-Reason": "Blob already exists (dedup)" });
    }

    return ctx.body(null, 200);
  });

  // ---------------------------------------------------------------------------
  // PUT /upload — BUD-02 upload
  // ---------------------------------------------------------------------------

  app.put("/upload", async (ctx) => {
    const reqId = ulid();
    const debugPrefix = `[upload:${reqId}]`;

    if (!config.upload.enabled) {
      debug(debugPrefix, "rejected: uploads disabled");
      return errorResponse(ctx, 403, "Uploads are disabled on this server");
    }

    // --- 1. Auth ---
    let auth: ReturnType<typeof requireAuth> | undefined;
    if (config.upload.requireAuth) {
      try {
        auth = requireAuth(ctx, "upload");
      } catch (err) {
        const msg = err instanceof HTTPException ? err.message : String(err);
        debug(debugPrefix, `rejected: auth failed — ${msg}`);
        if (err instanceof HTTPException) {
          return errorResponse(ctx, err.status as 401 | 403, err.message);
        }
        throw err;
      }
    }

    debug(
      debugPrefix,
      `PUT /upload — pubkey=${auth?.pubkey?.slice(0, 8) ?? "anon"}`,
    );

    // --- 2. Content-Length required (411 if absent) ---
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

    // --- 3. Size check (413 before reading body) ---
    if (contentLength > config.upload.maxSize) {
      await ctx.req.raw.body?.cancel();
      debug(
        debugPrefix,
        `rejected: file too large — ${contentLength} > ${config.upload.maxSize} bytes`,
      );
      return errorResponse(
        ctx,
        413,
        `File too large. Maximum allowed size is ${config.upload.maxSize} bytes`,
      );
    }

    // --- 4. MIME type check / storage rule gate ---
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

    // --- 5. X-SHA-256 validation + auth x-tag check ---
    const xSha256 = ctx.req.header("x-sha-256")?.toLowerCase() ?? null;
    if (xSha256 && !/^[0-9a-f]{64}$/.test(xSha256)) {
      await ctx.req.raw.body?.cancel();
      debug(debugPrefix, `rejected: invalid X-SHA-256 format — "${xSha256}"`);
      return errorResponse(ctx, 400, "Invalid X-SHA-256 header format");
    }

    // BUD-11: if the client provided X-SHA-256 and auth has x tags, we can
    // validate upfront. If X-SHA-256 is absent, defer the x-tag check until
    // after the worker resolves the actual hash (step 9).
    if (auth && xSha256) {
      try {
        requireXTag(auth, xSha256);
      } catch (err) {
        await ctx.req.raw.body?.cancel();
        const msg = err instanceof HTTPException ? err.message : String(err);
        debug(debugPrefix, `rejected: x-tag check failed — ${msg}`);
        if (err instanceof HTTPException) {
          return errorResponse(ctx, err.status as 403, err.message);
        }
        throw err;
      }
    }

    // Derive file extension from MIME type — used for on-disk filename and URL
    const ext = mimeToExt(mimeType);

    // --- 6. Dedup: if blob already exists, skip the whole write ---
    if (xSha256 && (await hasBlob(db, xSha256))) {
      await ctx.req.raw.body?.cancel();
      const existing = await getBlob(db, xSha256);
      if (existing) {
        debug(
          debugPrefix,
          `dedup hit — returning existing blob ${xSha256.slice(0, 8)}`,
        );
        // Register this pubkey as an owner if they aren't already
        if (auth && !(await isOwner(db, xSha256, auth.pubkey))) {
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

    // --- 8. Begin write session + dispatch to worker ---
    // beginWrite() allocates a local tmp file on disk. For local storage this
    // is inside the blobs dir (.tmp/). For S3 storage this is in the configured
    // s3.tmpDir. The worker writes directly to session.tmpPath — zero bytes
    // reach S3 until commitWrite() is called after hash verification.
    const session = await storage.beginWrite(contentLength);

    debug(
      debugPrefix,
      `dispatching to worker — size=${contentLength} mime=${mimeType} sha256=${
        xSha256?.slice(0, 8) ?? "unknown"
      }`,
    );

    const jobPromise = pool.dispatch(
      body,
      session.tmpPath,
      contentLength,
      xSha256,
    );
    if (!jobPromise) {
      // Race condition: another request claimed the last worker between
      // pool.available check and dispatch(). Rare but safe to handle.
      await body.cancel().catch(() => {});
      await storage.abortWrite(session).catch(() => {});
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
    let hash: string;
    let size: number;
    try {
      debug(
        debugPrefix,
        `awaiting worker result hash=${xSha256?.slice(0, 8) ?? "pending"}`,
      );
      ({ hash, size } = await jobPromise);
      debug(
        debugPrefix,
        `worker complete — hash=${hash.slice(0, 8)} size=${size}`,
      );
    } catch (err) {
      // Worker already deleted session.tmpPath on failure — abortWrite is a no-op.
      await storage.abortWrite(session).catch(() => {});
      const msg = err instanceof Error ? err.message : "Upload failed";
      debug(debugPrefix, `worker error — ${msg}`);
      return errorResponse(ctx, 400, msg);
    }

    // --- 9b. Deferred x-tag check (when X-SHA-256 was not sent upfront) ---
    // Now that we have the real hash, validate the scoped token can authorize it.
    if (auth && !xSha256) {
      try {
        requireXTag(auth, hash);
      } catch (err) {
        await storage.abortWrite(session).catch(() => {});
        const msg = err instanceof HTTPException ? err.message : String(err);
        debug(debugPrefix, `rejected: deferred x-tag check failed — ${msg}`);
        if (err instanceof HTTPException) {
          return errorResponse(ctx, err.status as 403, err.message);
        }
        throw err;
      }
    }

    // --- 10. Commit: move verified tmp file to final storage location ---
    // For local storage: atomic Deno.rename() to <hash>.<ext>.
    // For S3 storage: stream the verified local tmp file to S3, then delete it.
    // commitWrite() handles dedup internally (no-op if blob already exists).
    debug(debugPrefix, `commitWrite start hash=${hash} ext=${ext}`);
    const t0 = Date.now();
    try {
      await storage.commitWrite(session, hash, ext);
      const t1 = Date.now();
      debug(debugPrefix, `commitWrite complete elapsed=${t1 - t0}ms`);
    } catch (err) {
      await storage.abortWrite(session).catch(() => {});
      throw err;
    }

    // --- 11. Insert metadata ---
    const now = Math.floor(Date.now() / 1000);
    const blobRecord = {
      sha256: hash,
      size,
      type: mimeType !== "application/octet-stream" ? mimeType : null,
      uploaded: now,
    };
    debug(debugPrefix, `insertBlob start hash=${hash}`);
    const t2 = Date.now();
    await insertBlob(db, blobRecord, auth?.pubkey ?? "anonymous");
    const t3 = Date.now();
    debug(debugPrefix, `insertBlob complete elapsed=${t3 - t2}ms`);

    // --- 12. Return BlobDescriptor ---
    debug(
      debugPrefix,
      `upload complete — ${hash} (${size} bytes, ${
        blobRecord.type ?? "application/octet-stream"
      })`,
    );
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
