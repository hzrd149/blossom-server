/**
 * Blossom protocol router — assembles all BUD route handlers under a single
 * Hono sub-app with a BUD-01-compliant error handler (text/plain + X-Reason).
 *
 * Mount this at "/" in the parent app. The sub-app's onError is scoped to
 * these routes only, so non-Blossom routers (admin, landing) retain their
 * own error response formats.
 *
 * Route registration order matters — exact paths must come before the
 * /:sha256[.ext] blob catch-all:
 *   /report, /upload, /mirror, /media  →  DELETE /:sha256  →  /list/:pubkey  →  /:sha256[.ext]
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import { HTTPException } from "@hono/hono/http-exception";
import type { IBlobStorage } from "../storage/interface.ts";
import type { Config } from "../config/schema.ts";

import { buildBlobsRouter } from "./blobs.ts";
import { buildUploadRouter } from "./upload.ts";
import { buildMirrorRouter } from "./mirror.ts";
import { buildMediaRouter } from "./media.ts";
import { buildDeleteRouter } from "./delete.ts";
import { buildListRouter } from "./list.ts";
import { buildReportRouter } from "./report.ts";

export function buildBlossomRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono {
  const app = new Hono();

  // BUD-01-compliant error handler: all errors from Blossom route handlers are
  // returned as text/plain with an X-Reason header. This only fires for routes
  // registered on this sub-app — admin and landing retain their own formats.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const reason = err.message || "An error occurred";
      return c.body(reason, err.status, {
        "X-Reason": reason,
        "Content-Type": "text/plain",
      });
    }
    console.error("Unhandled error:", err);
    return c.body("Internal server error", 500, {
      "X-Reason": "Internal server error",
      "Content-Type": "text/plain",
    });
  });

  // BUD-09: PUT /report — mounted before blob catch-all so /report is not caught by /:sha256.
  if (config.report.enabled) {
    app.route("/", buildReportRouter(db, config));
  }

  // BUD-02 + BUD-06: PUT /upload, HEAD /upload
  // Mounted before blob catch-all so HEAD /upload is not caught by /:sha256.
  app.route("/", buildUploadRouter(db, storage, config));

  // BUD-04: PUT /mirror
  app.route("/", buildMirrorRouter(db, storage, config));

  // BUD-05: PUT /media, HEAD /media
  app.route("/", buildMediaRouter(db, storage, config));

  // BUD-02: DELETE /:sha256
  app.route("/", buildDeleteRouter(db, storage, config));

  // BUD-02: GET /list/:pubkey — mounted before blob catch-all so /list/:pubkey
  // is not caught by GET /:sha256.
  app.route("/", buildListRouter(db, config));

  // BUD-01: GET/HEAD /:sha256[.ext] — blob catch-all, must be last.
  app.route("/", buildBlobsRouter(db, storage, config));

  return app;
}
