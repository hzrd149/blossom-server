/**
 * BUD-02: GET /list/:pubkey — List blobs uploaded by a pubkey
 *
 * This endpoint is optional and marked unrecommended by the BUD-02 spec.
 * It is disabled by default (list.enabled = false).
 *
 * Spec requirements:
 *   - Returns a JSON array of BlobDescriptors sorted by uploaded date DESC
 *   - Supports cursor-based pagination via `cursor` (sha256) and `limit` query params
 *   - Supports optional `since` / `until` Unix timestamp filters
 *   - MAY require BUD-11 auth (controlled by list.requireAuth)
 *   - MAY restrict listing to own pubkey only (controlled by list.allowListOthers)
 */

import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import type { Client } from "@libsql/client";
import { listBlobsByPubkey } from "../db/blobs.ts";
import { optionalAuth, requireAuth } from "../middleware/auth.ts";
import type { BlossomVariables } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { Config } from "../config/schema.ts";
import { getBaseUrl, getBlobUrl } from "../utils/url.ts";

/** 64-character lowercase hex string — valid Nostr pubkey format */
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

/** BUD-02 Blob Descriptor */
interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
}

export function buildListRouter(
  db: Client,
  config: Config,
): Hono<{ Variables: BlossomVariables }> {
  const app = new Hono<{ Variables: BlossomVariables }>();

  app.get("/list/:pubkey", async (ctx) => {
    // --- Enabled gate ---
    if (!config.list.enabled) {
      return errorResponse(
        ctx,
        404,
        "List endpoint is disabled on this server",
      );
    }

    // --- Auth ---
    // Always call optionalAuth first to capture any supplied credential.
    // If requireAuth is true, enforce it via requireAuth() which throws 401/403.
    let auth: ReturnType<typeof optionalAuth>;
    if (config.list.requireAuth) {
      try {
        auth = requireAuth(ctx, "list");
      } catch (err) {
        if (err instanceof HTTPException) {
          return errorResponse(ctx, err.status as 401 | 403, err.message);
        }
        throw err;
      }
    } else {
      auth = optionalAuth(ctx);
    }

    // --- Pubkey validation ---
    const pubkey = ctx.req.param("pubkey").toLowerCase();
    if (!HEX_PUBKEY_RE.test(pubkey)) {
      return errorResponse(
        ctx,
        400,
        "Invalid pubkey: must be a 64-character lowercase hex string",
      );
    }

    // --- allowListOthers enforcement ---
    // When disabled, an authenticated caller may only list their own blobs.
    // Unauthenticated callers are always rejected when this guard is active.
    if (!config.list.allowListOthers) {
      if (!auth) {
        return errorResponse(ctx, 401, "Authorization required to list blobs");
      }
      if (auth.pubkey !== pubkey) {
        return errorResponse(ctx, 403, "You may only list your own blobs");
      }
    }

    // --- Query parameter parsing ---
    const rawLimit = ctx.req.query("limit");
    const rawSince = ctx.req.query("since");
    const rawUntil = ctx.req.query("until");
    const cursor = ctx.req.query("cursor") ?? undefined;

    const limit = rawLimit !== undefined ? parseInt(rawLimit, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1)) {
      return errorResponse(
        ctx,
        400,
        "Invalid limit: must be a positive integer",
      );
    }

    const since = rawSince !== undefined ? parseInt(rawSince, 10) : undefined;
    if (since !== undefined && isNaN(since)) {
      return errorResponse(ctx, 400, "Invalid since: must be a Unix timestamp");
    }

    const until = rawUntil !== undefined ? parseInt(rawUntil, 10) : undefined;
    if (until !== undefined && isNaN(until)) {
      return errorResponse(ctx, 400, "Invalid until: must be a Unix timestamp");
    }

    if (cursor !== undefined && !HEX_PUBKEY_RE.test(cursor)) {
      return errorResponse(
        ctx,
        400,
        "Invalid cursor: must be a 64-character sha256 hex string",
      );
    }

    // --- DB query ---
    const blobs = await listBlobsByPubkey(db, pubkey, {
      limit,
      cursor,
      since,
      until,
    });

    // --- Build response ---
    const baseUrl = getBaseUrl(ctx.req.raw, config.publicDomain);
    const descriptors: BlobDescriptor[] = blobs.map((b) => ({
      url: getBlobUrl(b.sha256, b.type, baseUrl),
      sha256: b.sha256,
      size: b.size,
      type: b.type ?? "application/octet-stream",
      uploaded: b.uploaded,
    }));

    return ctx.json(descriptors);
  });

  return app;
}
