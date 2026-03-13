/**
 * Assembles the Hono application and wires all routes and middleware.
 * Called once at startup with a fully-loaded config.
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { IBlobStorage } from "./storage/interface.ts";
import type { Config } from "./config/schema.ts";

import { corsMiddleware } from "./middleware/cors.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { onError } from "./middleware/errors.ts";

import { buildBlobsRouter } from "./routes/blobs.ts";
import { buildUploadRouter } from "./routes/upload.ts";
import { buildDeleteRouter } from "./routes/delete.ts";
import { buildListRouter } from "./routes/list.ts";
import { buildLandingRouter } from "./routes/landing.ts";

export function buildApp(
  db: Client,
  storage: IBlobStorage,
  storageDir: string,
  config: Config,
  landingWorker?: Worker,
): Hono {
  const app = new Hono();

  // Global error handler
  app.onError(onError);

  // BUD-01: CORS headers on all responses + OPTIONS preflight
  app.use("*", corsMiddleware);

  // BUD-11: parse auth header — populate ctx.var.auth (never blocks)
  app.use("*", authMiddleware(config.publicDomain));

  // Landing page: GET / and GET /assets/client.js (disabled by default)
  // Mounted first so GET / is claimed before the blob regex route.
  if (config.landing.enabled && landingWorker) {
    app.route("/", buildLandingRouter(landingWorker));
  }

  // BUD-01: GET/HEAD /:sha256[.ext]
  app.route("/", buildBlobsRouter(db, storage, config));

  // BUD-02 + BUD-06: PUT /upload, HEAD /upload
  // Upload route takes storageDir (not the storage adapter) because the
  // worker does file I/O directly and only needs the path for Deno.rename.
  app.route("/", buildUploadRouter(db, storageDir, config));

  // BUD-02: DELETE /:sha256
  app.route("/", buildDeleteRouter(db, storage, config));

  // BUD-02: GET /list/:pubkey (disabled by default)
  if (config.list.enabled) {
    app.route("/", buildListRouter(db, config));
  }

  return app;
}
