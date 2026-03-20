/**
 * BUD-02: DELETE /:sha256[.ext]
 *
 * Auth required (BUD-11, t=delete).
 * Checks that the requesting pubkey is an owner of the blob.
 * Multiple x tags must NOT be interpreted as multi-delete.
 *
 * Accepts both bare-hash URLs (DELETE /<sha256>) and extension URLs
 * (DELETE /<sha256>.jpg) — the extension is ignored; the hash is extracted
 * and used to look up the blob's stored MIME type, which determines the
 * on-disk filename.
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import { extension as extFromMime } from "@std/media-types";
import type { IBlobStorage } from "../storage/interface.ts";
import {
  countOwners,
  deleteBlob,
  getBlob,
  isOwner,
  removeOwner,
} from "../db/blobs.ts";
import { requireAuth, requireXTag } from "../middleware/auth.ts";
import type { BlossomVariables } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { Config } from "../config/schema.ts";

const SHA256_RE = /^[0-9a-f]{64}$/;

/** Derive the stored file extension from a MIME type. Empty string if none. */
function mimeToExt(mime: string | null): string {
  if (!mime || mime === "application/octet-stream") return "";
  return extFromMime(mime) ?? "";
}

export function buildDeleteRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono<{ Variables: BlossomVariables }> {
  const app = new Hono<{ Variables: BlossomVariables }>();

  // Accept both /<sha256> and /<sha256>.<ext> — extract hash from filename segment
  app.delete("/:filename", async (ctx) => {
    const filename = ctx.req.param("filename") ?? "";
    const match = filename.match(/([0-9a-f]{64})/);
    const hash = match?.[1] ?? "";

    if (!SHA256_RE.test(hash)) {
      return errorResponse(ctx, 400, "Invalid sha256 hash");
    }

    // Look up the blob before auth so we can return 404 early if it doesn't exist
    const blob = await getBlob(db, hash);
    if (!blob) {
      return errorResponse(ctx, 404, "Blob not found");
    }

    // Auth enforcement
    let pubkey: string | null = null;
    if (config.delete.requireAuth) {
      const auth = requireAuth(ctx, "delete");
      pubkey = auth.pubkey;

      // BUD-11: the delete auth event must include the blob hash in an x tag
      requireXTag(auth, hash);

      // Ownership check — only owners may delete their copy of a blob
      if (!(await isOwner(db, hash, pubkey))) {
        return errorResponse(ctx, 403, "You are not an owner of this blob");
      }
    }

    const ext = mimeToExt(blob.type);

    if (pubkey !== null) {
      // Remove only this pubkey's ownership record
      await removeOwner(db, hash, pubkey);

      // Check whether any other owners remain
      const remaining = await countOwners(db, hash);

      if (remaining > 0) {
        // Other owners still hold references — leave the blob in place
        return ctx.body(null, 200);
      }
    }

    // No owners left (or unauthenticated delete) — purge the blob entirely
    await deleteBlob(db, hash);

    // Remove from storage backend (best-effort — DB record is the source of truth)
    await storage.remove(hash, ext).catch((err) =>
      console.warn(`Failed to remove blob ${hash} from storage:`, err)
    );

    return ctx.body(null, 200);
  });

  return app;
}
