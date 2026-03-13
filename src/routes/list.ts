/**
 * BUD-02: GET /list/:pubkey — List blobs uploaded by a pubkey.
 *
 * Optional endpoint (disabled by default per BUD-02 spec).
 * Supports cursor-based pagination via ?cursor=<sha256>&limit=<n>
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import { listBlobsByPubkey } from "../db/blobs.ts";
import { optionalAuth, requireAuth } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { Config } from "../config/schema.ts";

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

export function buildListRouter(db: Client, config: Config): Hono {
  const app = new Hono();

  app.get("/list/:pubkey", async (ctx) => {
    if (!config.list.enabled) {
      return errorResponse(
        ctx,
        404,
        "List endpoint is not enabled on this server",
      );
    }

    const pubkey = ctx.req.param("pubkey");
    if (!HEX_PUBKEY_RE.test(pubkey)) {
      return errorResponse(
        ctx,
        400,
        "Invalid pubkey format (expected 64-char hex)",
      );
    }

    // Auth enforcement
    if (config.list.requireAuth) {
      const auth = requireAuth(ctx, "list");

      // If allowListOthers is false, only allow listing own blobs
      if (!config.list.allowListOthers && auth.pubkey !== pubkey) {
        return errorResponse(
          ctx,
          403,
          "Not authorized to list blobs for other pubkeys",
        );
      }
    } else {
      const auth = optionalAuth(ctx);
      if (!config.list.allowListOthers && auth?.pubkey !== pubkey) {
        return errorResponse(
          ctx,
          403,
          "Not authorized to list blobs for other pubkeys",
        );
      }
    }

    // Parse query params
    const url = new URL(ctx.req.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const sinceParam = url.searchParams.get("since");
    const untilParam = url.searchParams.get("until");

    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 100;
    const since = sinceParam ? parseInt(sinceParam, 10) : undefined;
    const until = untilParam ? parseInt(untilParam, 10) : undefined;

    const blobs = await listBlobsByPubkey(db, pubkey, {
      limit,
      cursor,
      since,
      until,
    });

    return ctx.json(blobs);
  });

  return app;
}
