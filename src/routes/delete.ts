/**
 * BUD-02: DELETE /:sha256
 *
 * Auth required (BUD-11, t=delete).
 * Checks that the requesting pubkey is an owner of the blob.
 * Multiple x tags must NOT be interpreted as multi-delete.
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { IBlobStorage } from "../storage/interface.ts";
import { deleteBlob, isOwner } from "../db/blobs.ts";
import { requireAuth, requireXTag } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { Config } from "../config/schema.ts";

const SHA256_RE = /^[0-9a-f]{64}$/;

export function buildDeleteRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono {
  const app = new Hono();

  app.delete("/:hash{[0-9a-f]{64}}", async (ctx) => {
    const hash = ctx.req.param("hash");

    if (!SHA256_RE.test(hash)) {
      return errorResponse(ctx, 400, "Invalid sha256 hash");
    }

    // Auth enforcement
    let pubkey = "anonymous";
    if (config.delete.requireAuth) {
      const auth = requireAuth(ctx, "delete");
      pubkey = auth.pubkey;

      // BUD-11: x tags for delete require the hash to be listed
      requireXTag(auth, hash);

      // Ownership check — DELETE requires being an owner of the blob
      if (!await isOwner(db, hash, pubkey)) {
        return errorResponse(ctx, 403, "You are not an owner of this blob");
      }
    }

    // Remove from storage + DB (cascade deletes owners and accessed records)
    const existed = await deleteBlob(db, hash);
    if (!existed) {
      return errorResponse(ctx, 404, "Blob not found");
    }

    // Remove from storage backend (best-effort — DB record is the source of truth)
    await storage.remove(hash).catch((err) =>
      console.warn(`Failed to remove blob ${hash} from storage:`, err)
    );

    return ctx.body(null, 200);
  });

  return app;
}
