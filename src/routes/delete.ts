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
import { deleteBlob, getBlob, isOwner } from "../db/blobs.ts";
import { requireAuth, requireXTag } from "../middleware/auth.ts";
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
): Hono {
  const app = new Hono();

  // Accept both /<sha256> and /<sha256>.<ext> — extract hash from filename segment
  app.delete("/:filename", async (ctx) => {
    const filename = ctx.req.param("filename") ?? "";
    const match = filename.match(/([0-9a-f]{64})/);
    const hash = match?.[1] ?? "";

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

    // Look up the blob to get its MIME type — needed to derive on-disk filename
    const blob = await getBlob(db, hash);
    const ext = blob ? mimeToExt(blob.type) : "";

    // Remove from storage + DB (cascade deletes owners and accessed records)
    const existed = await deleteBlob(db, hash);
    if (!existed) {
      return errorResponse(ctx, 404, "Blob not found");
    }

    // Remove from storage backend (best-effort — DB record is the source of truth)
    await storage.remove(hash, ext).catch((err) =>
      console.warn(`Failed to remove blob ${hash} from storage:`, err)
    );

    return ctx.body(null, 200);
  });

  return app;
}
