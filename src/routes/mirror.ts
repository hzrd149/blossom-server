/**
 * BUD-04: PUT /mirror — Mirror a blob from a remote URL
 *
 * Pipeline (main thread unless noted):
 *   1.  config.mirror.enabled check → 403
 *   2.  BUD-11 auth check (t="upload") → 401/403
 *   3.  Parse JSON body { url } → 400
 *   4.  Validate URL scheme (http/https only) → 400
 *   5.  SSRF guard: reject bare private/loopback IP addresses → 400
 *   6.  Pre-fetch pool check (pool.available === 0) → 503
 *   7.  Outbound fetch with AbortSignal.timeout → 502 on error/timeout
 *   8.  Non-2xx origin response → 502
 *   9.  Content-Length > maxSize → 413 (body never streamed to worker)
 *  10.  Content-Type allowlist check → 415
 *  11.  Dispatch response.body to upload worker (zero-copy stream transfer)
 *       → null (race) → 503
 *  12.  Await { hash, size } from worker
 *  13.  BUD-11 x-tag verification (post-hash, strict):
 *         - Auth present + 0 x tags → 403 (x tag is REQUIRED for PUT /mirror)
 *         - Auth present + x tags present but none matches hash → 403
 *  14.  Dedup guard: if blob already exists, skip rename, add owner, return descriptor
 *  15.  Atomic Deno.rename(tmpPath → <storageDir>/<hash>[.<ext>])
 *  16.  insertBlob() — metadata write
 *  17.  Return BlobDescriptor JSON 200
 *
 * Spam / overload protection layers:
 *   L1 — Pre-fetch pool check: no TCP connection opened when workers are full
 *   L2 — Fetch timeout (AbortSignal.timeout): hung origins release worker slots
 *   L3 — Content-Length gate: 413 before any body bytes flow to the worker
 *   L4 — No-queue pool policy: dispatch() → null → 503, zero accumulation
 */

import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import type { Client } from "@libsql/client";
import { ulid } from "@std/ulid";
import { getBlob, hasBlob, insertBlob, isOwner } from "../db/blobs.ts";
import { requireAuth } from "../middleware/auth.ts";
import { debug } from "../middleware/debug.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import { getPool } from "../workers/pool.ts";
import type { Config } from "../config/schema.ts";
import { mimeToExt } from "../utils/mime.ts";
import { getFileRule } from "../prune/rules.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** BUD-02 Blob Descriptor (same shape as upload route) */
interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
}

// ---------------------------------------------------------------------------
// Private RFC-1918 / loopback CIDR ranges for SSRF guard
// ---------------------------------------------------------------------------

/** Returns true if a dotted-decimal IPv4 string falls in a private/loopback range. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false; // not a valid IPv4 — let the fetch attempt fail naturally
  }
  const [a, b] = parts;
  return (
    a === 127 || // 127.0.0.0/8   loopback
    a === 10 || // 10.0.0.0/8    RFC-1918
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 RFC-1918
    (a === 192 && b === 168) || // 192.168.0.0/16 RFC-1918
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local
    (a === 0) // 0.0.0.0/8
  );
}

/** Returns true if a colon-hex IPv6 string is loopback (::1) or unspecified (::). */
function isPrivateIPv6(ip: string): boolean {
  // Normalise: strip brackets if present (e.g. [::1])
  const bare = ip.replace(/^\[|\]$/g, "");
  return bare === "::1" || bare === "::" ||
    bare.toLowerCase() === "0:0:0:0:0:0:0:1";
}

/**
 * Best-effort SSRF guard for literal IP addresses in the URL hostname.
 * Hostname-based DNS rebinding is out of scope — the fetch timeout is the
 * primary mitigation for that class of attack.
 *
 * Returns an error string if the hostname is a disallowed IP, or null if OK.
 */
function checkSsrf(hostname: string): string | null {
  if (isPrivateIPv4(hostname)) {
    return `Mirror URL points to a private IPv4 address: ${hostname}`;
  }
  if (isPrivateIPv6(hostname)) {
    return `Mirror URL points to a loopback IPv6 address: ${hostname}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBlobUrl(
  hash: string,
  mimeType: string | null,
  baseUrl: string,
): string {
  const ext = mimeToExt(mimeType);
  return `${baseUrl}/${hash}${ext ? `.${ext}` : ""}`;
}

function isAllowedType(mimeType: string, allowedTypes: string[]): boolean {
  const [mainType] = mimeType.split("/");
  return allowedTypes.some((allowed) => {
    if (allowed === "*" || allowed === "*/*") return true;
    if (allowed.endsWith("/*")) return allowed.slice(0, -2) === mainType;
    return allowed === mimeType;
  });
}

function getBaseUrl(request: Request, publicDomain: string): string {
  if (publicDomain) {
    // publicDomain is a bare hostname (e.g. "cdn.example.com").
    // Strip any accidental trailing slash and prepend https://.
    return `https://${publicDomain.replace(/\/$/, "")}`;
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function buildMirrorRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono {
  const app = new Hono();

  app.put("/mirror", async (ctx) => {
    const reqId = ulid();
    const debugPrefix = `[mirror:${reqId}]`;

    // --- 1. Feature flag ---
    if (!config.mirror.enabled) {
      debug(debugPrefix, "rejected: mirroring disabled");
      return errorResponse(ctx, 403, "Mirroring is disabled on this server");
    }

    // --- 2. BUD-11 auth (t="upload", same verb as PUT /upload per spec) ---
    let auth: ReturnType<typeof requireAuth> | undefined;
    if (config.mirror.requireAuth) {
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
    } else {
      // Auth is optional — capture it if present for owner registration
      auth = ctx.get("auth");
    }

    // --- 3. Parse JSON body { url } ---
    let mirrorUrl: URL;
    try {
      const body = await ctx.req.json() as { url?: unknown };
      if (!body.url || typeof body.url !== "string") {
        debug(debugPrefix, "rejected: missing url field in body");
        return errorResponse(
          ctx,
          400,
          'Request body must be a JSON object with a "url" string field',
        );
      }
      mirrorUrl = new URL(body.url);
    } catch {
      debug(debugPrefix, "rejected: invalid JSON body");
      return errorResponse(
        ctx,
        400,
        "Invalid request body: expected JSON { url: string }",
      );
    }

    debug(
      debugPrefix,
      `PUT /mirror — url=${mirrorUrl.toString()} pubkey=${
        auth?.pubkey?.slice(0, 8) ?? "anon"
      }`,
    );

    // --- 4. URL scheme validation ---
    if (mirrorUrl.protocol !== "http:" && mirrorUrl.protocol !== "https:") {
      debug(
        debugPrefix,
        `rejected: unsupported scheme — ${mirrorUrl.protocol}`,
      );
      return errorResponse(
        ctx,
        400,
        `Unsupported URL scheme: ${mirrorUrl.protocol}. Only http and https are allowed`,
      );
    }

    // --- 5. SSRF guard: reject literal private / loopback IP addresses ---
    const ssrfError = checkSsrf(mirrorUrl.hostname);
    if (ssrfError) {
      debug(debugPrefix, `rejected: SSRF guard — ${ssrfError}`);
      return errorResponse(ctx, 400, ssrfError);
    }

    // --- 6. Pre-fetch pool check (before opening any TCP connection) ---
    // If all workers are busy, fail immediately without touching the network.
    if (getPool().available === 0) {
      debug(debugPrefix, "rejected: all upload workers busy (pre-fetch)");
      return errorResponse(
        ctx,
        503,
        "Server busy. All upload workers are occupied. Try again shortly.",
      );
    }

    // --- 7. Outbound fetch with timeout ---
    debug(
      debugPrefix,
      `fetching origin url=${mirrorUrl.toString()} timeout=${config.mirror.fetchTimeout}ms`,
    );
    const t0 = Date.now();
    let originResponse: Response;
    try {
      const signal = config.mirror.fetchTimeout > 0
        ? AbortSignal.timeout(config.mirror.fetchTimeout)
        : undefined;
      originResponse = await fetch(mirrorUrl.toString(), { signal });
      const t1 = Date.now();
      debug(
        debugPrefix,
        `origin responded status=${originResponse.status} elapsed=${t1 - t0}ms`,
      );
    } catch (err) {
      const t1 = Date.now();
      const reason = err instanceof Error && err.name === "TimeoutError"
        ? `Origin server did not respond within ${config.mirror.fetchTimeout}ms`
        : `Failed to fetch from origin: ${
          err instanceof Error ? err.message : String(err)
        }`;
      debug(debugPrefix, `fetch failed elapsed=${t1 - t0}ms — ${reason}`);
      return errorResponse(ctx, 502, reason);
    }

    // --- 8. Non-2xx origin response ---
    if (!originResponse.ok) {
      await originResponse.body?.cancel();
      debug(
        debugPrefix,
        `rejected: origin ${originResponse.status} ${originResponse.statusText}`,
      );
      return errorResponse(
        ctx,
        502,
        `Origin server returned ${originResponse.status} ${originResponse.statusText}`,
      );
    }

    // --- 9. Content-Length gate (413 before any body bytes flow to the worker) ---
    const contentLengthHeader = originResponse.headers.get("content-length");
    const contentLength = contentLengthHeader
      ? parseInt(contentLengthHeader, 10)
      : null;
    if (
      contentLength !== null && !isNaN(contentLength) &&
      contentLength > config.upload.maxSize
    ) {
      await originResponse.body?.cancel();
      debug(
        debugPrefix,
        `rejected: remote blob too large — ${contentLength} > ${config.upload.maxSize} bytes`,
      );
      return errorResponse(
        ctx,
        413,
        `Remote blob too large. Maximum allowed size is ${config.upload.maxSize} bytes`,
      );
    }

    // --- 10. Content-Type check / storage rule gate ---
    // BUD-04: use Content-Type from origin; fall back to application/octet-stream.
    const rawContentType = originResponse.headers.get("content-type") ??
      "application/octet-stream";
    const mimeType = rawContentType.split(";")[0].trim() ||
      "application/octet-stream";

    debug(
      debugPrefix,
      `origin content-type=${mimeType} content-length=${
        contentLength ?? "unknown"
      }`,
    );

    if (config.storage.rules.length > 0) {
      // When storage.rules is non-empty, rules are the single upload gate (legacy behavior).
      const rule = getFileRule(
        { mimeType, pubkey: auth?.pubkey },
        config.storage.rules,
        config.upload.requirePubkeyInRule,
      );
      if (!rule) {
        await originResponse.body?.cancel();
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
    } else if (
      config.upload.allowedTypes.length > 0 &&
      !isAllowedType(mimeType, config.upload.allowedTypes)
    ) {
      await originResponse.body?.cancel();
      debug(debugPrefix, `rejected: unsupported media type — ${mimeType}`);
      return errorResponse(ctx, 415, `Unsupported media type: ${mimeType}`);
    }

    // --- 11. Begin write session + dispatch to upload worker ---
    // beginWrite() allocates a local tmp file. Zero bytes reach S3 until
    // commitWrite() is called after hash verification.
    const body = originResponse.body;
    if (!body) {
      debug(debugPrefix, "rejected: origin returned empty body");
      return errorResponse(ctx, 502, "Origin server returned an empty body");
    }

    const pool = getPool();
    const session = await storage.beginWrite(contentLength);

    debug(
      debugPrefix,
      `dispatching to worker — size=${
        contentLength ?? "unknown"
      } mime=${mimeType}`,
    );

    // Pass null as xSha256 — the hash is unknown pre-download. The x-tag
    // verification happens post-hash (step 13) after the worker returns.
    const jobPromise = pool.dispatch(
      body,
      session.tmpPath,
      contentLength,
      null,
    );
    if (!jobPromise) {
      // Race: another request claimed the last worker between step 6 and now.
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

    // --- 12. Await worker result ---
    let hash: string;
    let size: number;
    debug(debugPrefix, "awaiting worker result");
    try {
      ({ hash, size } = await jobPromise);
      debug(
        debugPrefix,
        `worker complete — hash=${hash.slice(0, 8)} size=${size}`,
      );
    } catch (err) {
      // Worker already deleted session.tmpPath on failure.
      await storage.abortWrite(session).catch(() => {});
      const msg = err instanceof Error ? err.message : "Mirror failed";
      debug(debugPrefix, `worker error — ${msg}`);
      return errorResponse(
        ctx,
        400,
        err instanceof Error ? err.message : "Mirror failed",
      );
    }

    // --- 13. BUD-11 x-tag verification (strict, post-hash) ---
    // Per BUD-11: x tag is REQUIRED for PUT /mirror.
    //   - If auth is present and no x tags exist → 403 (token not scoped to any blob)
    //   - If auth is present and x tags exist but none matches computed hash → 403
    // We intentionally do NOT use requireXTag() here because that function
    // passes silently when no x tags are present. Mirror requires them.
    if (auth) {
      const xTags = auth.tags.filter((t) => t[0] === "x");
      if (xTags.length === 0) {
        await storage.abortWrite(session).catch(() => {});
        debug(
          debugPrefix,
          `rejected: auth event missing x tag for hash=${hash.slice(0, 8)}`,
        );
        return errorResponse(
          ctx,
          403,
          "Auth event is missing required x tag for PUT /mirror",
        );
      }
      if (!xTags.some((t) => t[1] === hash)) {
        await storage.abortWrite(session).catch(() => {});
        debug(
          debugPrefix,
          `rejected: x tag mismatch — hash=${
            hash.slice(0, 8)
          } not in auth tags`,
        );
        return errorResponse(
          ctx,
          403,
          `Auth token does not authorize mirroring blob ${hash}`,
        );
      }
    }

    const ext = mimeToExt(mimeType);

    // --- 14. Dedup guard ---
    if (await hasBlob(db, hash)) {
      await storage.abortWrite(session).catch(() => {});
      const existing = await getBlob(db, hash);
      if (existing) {
        debug(
          debugPrefix,
          `dedup hit — returning existing blob ${hash.slice(0, 8)}`,
        );
        if (auth && !await isOwner(db, hash, auth.pubkey)) {
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

    // --- 15. Commit: move verified tmp file to final storage location ---
    // For local: atomic rename. For S3: stream to bucket, delete local tmp.
    debug(debugPrefix, `commitWrite start hash=${hash} ext=${ext}`);
    const t2 = Date.now();
    try {
      await storage.commitWrite(session, hash, ext);
      const t3 = Date.now();
      debug(debugPrefix, `commitWrite complete elapsed=${t3 - t2}ms`);
    } catch (err) {
      await storage.abortWrite(session).catch(() => {});
      throw err;
    }

    // --- 16. Insert metadata ---
    const now = Math.floor(Date.now() / 1000);
    const blobRecord = {
      sha256: hash,
      size,
      type: mimeType !== "application/octet-stream" ? mimeType : null,
      uploaded: now,
    };
    debug(debugPrefix, `insertBlob start hash=${hash}`);
    const t4 = Date.now();
    await insertBlob(db, blobRecord, auth?.pubkey ?? "anonymous");
    const t5 = Date.now();
    debug(debugPrefix, `insertBlob complete elapsed=${t5 - t4}ms`);

    // --- 17. Return BlobDescriptor ---
    debug(
      debugPrefix,
      `mirror complete — ${hash} (${size} bytes, ${
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
