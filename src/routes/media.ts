import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import type { Client } from "@libsql/client";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { extension as extFromMime, typeByExtension } from "@std/media-types";
import { ulid } from "@std/ulid";
import {
  getBlob,
  getMediaDerivative,
  getMediaThumbnail,
  hasBlob,
  insertBlob,
  insertBlobRecord,
  insertMediaDerivative,
  insertMediaThumbnail,
  isOwner,
} from "../db/blobs.ts";
import { requireAuth } from "../middleware/auth.ts";
import type { BlossomVariables } from "../middleware/auth.ts";
import { debug } from "../middleware/debug.ts";
import { errorResponse } from "../middleware/errors.ts";
import { optimizeMedia } from "../optimize/index.ts";
import { extractDimensions } from "../optimize/dimensions.ts";
import { createThumbnail } from "../optimize/thumbnail.ts";
import { getFileRule } from "../prune/rules.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import { type Nip94Tag, nip94Tags, optionalNip94Tags } from "../utils/nip94.ts";
import { getBaseUrl, getBlobUrl } from "../utils/url.ts";
import { getPool, WorkerJobError } from "../workers/pool.ts";
import type { Config } from "../config/schema.ts";

interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
  /** Additional NIP-94 file metadata tags. */
  nip94?: Nip94Tag[];
}

function mimeToExt(mime: string | null): string {
  if (!mime || mime === "application/octet-stream") return "";
  return extFromMime(mime) ?? "";
}

async function* streamChunks(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array<ArrayBuffer>> {
  for await (const chunk of stream) {
    yield new Uint8Array(chunk);
  }
}

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

  const [hashBuf] = await Promise.all([
    stdCrypto.subtle.digest("SHA-256", streamChunks(s1)),
    s2.pipeThrough(countingTransform).pipeTo(new WritableStream()),
  ]);

  return { hash: encodeHex(new Uint8Array(hashBuf)), size };
}

function detectOptimizedMime(filePath: string): string {
  const dotExt = filePath.match(/\.([^.]+)$/)?.[1];
  if (!dotExt) return "application/octet-stream";
  return typeByExtension(dotExt) ?? "application/octet-stream";
}

async function getThumbnailTag(
  db: Client,
  parentSha256: string,
  baseUrl: string,
): Promise<Nip94Tag | null> {
  const thumbnail = await getMediaThumbnail(db, parentSha256);
  if (!thumbnail) return null;
  return [
    "thumb",
    getBlobUrl(thumbnail.sha256, thumbnail.type, baseUrl),
    thumbnail.sha256,
  ];
}

interface PreparedThumbnail {
  path: string;
  sha256: string;
  size: number;
  type: string | null;
  ext: string;
  dim: string | null;
}

async function prepareThumbnail(
  inputPath: string,
  inputType: string | null,
  config: Config,
): Promise<PreparedThumbnail | null> {
  if (!config.media.thumbnail.enabled) return null;

  const path = await createThumbnail(
    inputPath,
    inputType,
    config.media.thumbnail,
    config.media.tmpDir,
  );
  try {
    const { hash, size } = await hashFile(path);
    const type = detectOptimizedMime(path);
    const storedType = type !== "application/octet-stream" ? type : null;
    const dim = await extractDimensions(path, storedType);
    return {
      path,
      sha256: hash,
      size,
      type: storedType,
      ext: mimeToExt(type),
      dim,
    };
  } catch (err) {
    await Deno.remove(path).catch(() => {});
    throw err;
  }
}

async function storePreparedThumbnail(
  opts: {
    db: Client;
    storage: IBlobStorage;
    thumbnail: PreparedThumbnail;
    parentSha256: string;
    now: number;
    baseUrl: string;
  },
): Promise<Nip94Tag> {
  await opts.storage.commitFile(
    opts.thumbnail.path,
    opts.thumbnail.sha256,
    opts.thumbnail.ext,
  );
  await insertBlobRecord(opts.db, {
    sha256: opts.thumbnail.sha256,
    size: opts.thumbnail.size,
    type: opts.thumbnail.type,
    uploaded: opts.now,
    nip94: optionalNip94Tags({ dim: opts.thumbnail.dim }),
  });
  await insertMediaThumbnail(opts.db, opts.parentSha256, opts.thumbnail.sha256);

  return [
    "thumb",
    getBlobUrl(opts.thumbnail.sha256, opts.thumbnail.type, opts.baseUrl),
    opts.thumbnail.sha256,
  ];
}

async function createAndStoreThumbnail(
  opts: {
    db: Client;
    storage: IBlobStorage;
    inputPath: string;
    inputType: string | null;
    parentSha256: string;
    now: number;
    config: Config;
    baseUrl: string;
    debugPrefix: string;
  },
): Promise<Nip94Tag | null> {
  let thumbnail: PreparedThumbnail | null = null;
  try {
    thumbnail = await prepareThumbnail(
      opts.inputPath,
      opts.inputType,
      opts.config,
    );
    if (!thumbnail) return null;
    const tag = await storePreparedThumbnail({
      db: opts.db,
      storage: opts.storage,
      thumbnail,
      parentSha256: opts.parentSha256,
      now: opts.now,
      baseUrl: opts.baseUrl,
    });
    thumbnail = null;

    debug(opts.debugPrefix, `thumbnail=${tag[2].slice(0, 8)}`);
    return tag;
  } catch (err) {
    if (thumbnail) await Deno.remove(thumbnail.path).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    debug(opts.debugPrefix, `thumbnail skipped — ${msg}`);
    return null;
  }
}

export function buildMediaRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono<{ Variables: BlossomVariables }> {
  const app = new Hono<{ Variables: BlossomVariables }>();

  // Hono does not support HEAD-only routes directly; register as GET and
  // the framework strips the body automatically for HEAD requests.
  app.get("/media", (ctx) => {
    if (!config.media.enabled) {
      return errorResponse(
        ctx,
        403,
        "Media endpoint is disabled on this server",
      );
    }

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

    if (getPool().available === 0) {
      return errorResponse(
        ctx,
        503,
        "Server busy. All upload workers are occupied. Try again shortly.",
      );
    }

    const xContentLength = ctx.req.header("x-content-length") ??
      ctx.req.header("content-length");
    if (xContentLength) {
      const size = parseInt(xContentLength, 10);
      if (!isNaN(size) && size > config.media.maxSize) {
        return errorResponse(
          ctx,
          413,
          `File too large. Maximum allowed size is ${config.media.maxSize} bytes`,
        );
      }
    }

    const xContentType = ctx.req.header("x-content-type") ??
      ctx.req.header("content-type");
    if (xContentType) {
      const mimeType = xContentType.split(";")[0].trim();
      const mimeRule = getFileRule(
        { mimeType, pubkey: ctx.get("auth")?.pubkey },
        config.storage.rules,
        config.media.requirePubkeyInRule,
      );
      if (!mimeRule) {
        if (config.media.requirePubkeyInRule) {
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
    }

    return ctx.body(null, 200);
  });

  app.put("/media", async (ctx) => {
    const reqId = ulid();
    const debugPrefix = `[media:${reqId}]`;

    // Track temp paths for cleanup on error
    let tmpPath: string | null = null;
    let optimizedTmpPath: string | null = null;

    try {
      if (!config.media.enabled) {
        debug(debugPrefix, "rejected: media endpoint disabled");
        return errorResponse(
          ctx,
          403,
          "Media endpoint is disabled on this server",
        );
      }

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

      const contentType = ctx.req.header("content-type") ??
        "application/octet-stream";
      const mimeType = contentType.split(";")[0].trim();
      const mimeRule = getFileRule(
        { mimeType, pubkey: auth?.pubkey },
        config.storage.rules,
        config.media.requirePubkeyInRule,
      );
      if (!mimeRule) {
        await ctx.req.raw.body?.cancel();
        debug(
          debugPrefix,
          `rejected: no storage rule matches — mime=${mimeType}`,
        );
        if (config.media.requirePubkeyInRule) {
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

      const xSha256 = ctx.req.header("x-sha-256")?.toLowerCase() ?? null;
      if (xSha256 && !/^[0-9a-f]{64}$/.test(xSha256)) {
        await ctx.req.raw.body?.cancel();
        debug(debugPrefix, `rejected: invalid X-SHA-256 format — "${xSha256}"`);
        return errorResponse(ctx, 400, "Invalid X-SHA-256 header format");
      }

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
        if (
          err instanceof WorkerJobError && err.errorType === "HASH_MISMATCH"
        ) {
          return errorResponse(ctx, 409, msg);
        }
        return errorResponse(ctx, 400, msg);
      }

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
          const url = getBlobUrl(existing.sha256, existing.type, baseUrl);
          const type = existing.type ?? "application/octet-stream";
          const thumbnailTag = await getThumbnailTag(
            db,
            existing.sha256,
            baseUrl,
          );
          return ctx.json(
            {
              url,
              sha256: existing.sha256,
              size: existing.size,
              type,
              uploaded: existing.uploaded,
              nip94: nip94Tags({
                url,
                sha256: existing.sha256,
                size: existing.size,
                type,
                tags: [
                  ...(existing.nip94 ?? []),
                  ["ox", originalHash],
                  ...(thumbnailTag ? [thumbnailTag] : []),
                ],
              }),
            } satisfies BlobDescriptor,
            201,
          );
        }
        // Derivative record exists but blob was pruned — fall through to re-optimize
      }

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
        return errorResponse(ctx, 422, msg);
      }

      await Deno.remove(origTmpPath).catch(() => {});
      tmpPath = null;

      const optPath = optimizedTmpPath!;

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

      const optimizedMime = detectOptimizedMime(optPath);
      const optimizedExt = mimeToExt(optimizedMime);

      if (await hasBlob(db, optimizedHash)) {
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
          let thumbnailTag = await getThumbnailTag(
            db,
            existing.sha256,
            baseUrl,
          );
          if (!thumbnailTag) {
            thumbnailTag = await createAndStoreThumbnail({
              db,
              storage,
              inputPath: optPath,
              inputType: existing.type,
              parentSha256: existing.sha256,
              now: Math.floor(Date.now() / 1000),
              config,
              baseUrl,
              debugPrefix,
            });
          }
          await Deno.remove(optPath).catch(() => {});
          optimizedTmpPath = null;
          const url = getBlobUrl(existing.sha256, existing.type, baseUrl);
          const type = existing.type ?? "application/octet-stream";
          return ctx.json(
            {
              url,
              sha256: existing.sha256,
              size: existing.size,
              type,
              uploaded: existing.uploaded,
              nip94: nip94Tags({
                url,
                sha256: existing.sha256,
                size: existing.size,
                type,
                tags: [
                  ...(existing.nip94 ?? []),
                  ["ox", originalHash],
                  ...(thumbnailTag ? [thumbnailTag] : []),
                ],
              }),
            } satisfies BlobDescriptor,
            201,
          );
        }
        await Deno.remove(optPath).catch(() => {});
        optimizedTmpPath = null;
      }

      const optimizedType = optimizedMime !== "application/octet-stream"
        ? optimizedMime
        : null;
      const dim = await extractDimensions(optPath, optimizedType);
      debug(debugPrefix, `dim=${dim ?? "none"}`);

      let preparedThumbnail: PreparedThumbnail | null = null;
      try {
        preparedThumbnail = await prepareThumbnail(
          optPath,
          optimizedType,
          config,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        debug(debugPrefix, `thumbnail skipped — ${msg}`);
      }

      try {
        await storage.commitFile(optPath, optimizedHash, optimizedExt);
      } catch (err) {
        await Deno.remove(optPath).catch(() => {});
        if (preparedThumbnail) {
          await Deno.remove(preparedThumbnail.path).catch(() => {});
        }
        throw err;
      }
      optimizedTmpPath = null;

      const now = Math.floor(Date.now() / 1000);
      const blobRecord = {
        sha256: optimizedHash,
        size: optimizedSize,
        type: optimizedType,
        uploaded: now,
        nip94: optionalNip94Tags({ dim, originalSha256: originalHash }),
      };
      await insertBlob(db, blobRecord, auth?.pubkey ?? "anonymous");
      await insertMediaDerivative(db, originalHash, optimizedHash);

      const baseUrl = getBaseUrl(ctx.req.raw, config.publicDomain);
      let thumbnailTag: Nip94Tag | null = null;
      if (preparedThumbnail) {
        const thumbnailToStore = preparedThumbnail;
        try {
          thumbnailTag = await storePreparedThumbnail({
            db,
            storage,
            thumbnail: thumbnailToStore,
            parentSha256: optimizedHash,
            now,
            baseUrl,
          });
          preparedThumbnail = null;
        } catch (err) {
          await Deno.remove(thumbnailToStore.path).catch(() => {});
          preparedThumbnail = null;
          const msg = err instanceof Error ? err.message : String(err);
          debug(debugPrefix, `thumbnail skipped — ${msg}`);
        }
      }

      debug(
        debugPrefix,
        `media upload complete — ${optimizedHash} (${optimizedSize} bytes, ${optimizedMime})`,
      );
      const url = getBlobUrl(optimizedHash, blobRecord.type, baseUrl);
      const type = blobRecord.type ?? "application/octet-stream";
      return ctx.json(
        {
          url,
          sha256: optimizedHash,
          size: optimizedSize,
          type,
          uploaded: now,
          nip94: nip94Tags({
            url,
            sha256: optimizedHash,
            size: optimizedSize,
            type,
            tags: [
              ...(blobRecord.nip94 ?? []),
              ...(thumbnailTag ? [thumbnailTag] : []),
            ],
          }),
        } satisfies BlobDescriptor,
        201,
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
