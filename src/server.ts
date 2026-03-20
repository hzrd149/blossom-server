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
import { requestLogger } from "./middleware/logger.ts";

import { buildBlobsRouter } from "./routes/blobs.ts";
import { buildUploadRouter } from "./routes/upload.ts";
import { buildMirrorRouter } from "./routes/mirror.ts";
import { buildMediaRouter } from "./routes/media.ts";
import { buildDeleteRouter } from "./routes/delete.ts";
import { buildListRouter } from "./routes/list.ts";
import { buildLandingRouter } from "./routes/landing.tsx";
import { buildAdminRouter } from "./routes/admin-router.tsx";
import { buildReportRouter } from "./routes/report.ts";

export function buildApp(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Hono {
  const app = new Hono();

  // Global error handler
  app.onError(onError);

  // Request/response logging
  app.use("*", requestLogger);

  // BUD-01: CORS headers on all responses + OPTIONS preflight
  app.use("*", corsMiddleware);

  // BUD-11: parse auth header — populate ctx.var.auth (never blocks)
  app.use("*", authMiddleware(config.publicDomain));

  // Serve favicon from the public folder — always registered so the server
  // never returns a 404 for /favicon.ico regardless of other feature flags.
  app.get("/favicon.ico", async (c) => {
    try {
      const file = await Deno.readFile("./public/favicon.ico");
      return c.body(file, 200, {
        "Content-Type": "image/x-icon",
        "Cache-Control": "public, max-age=86400",
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  // Landing page: GET / and GET /assets/client.js (disabled by default)
  // Mounted first so GET / is claimed before the blob regex route.
  if (config.landing.enabled) {
    app.route("/", buildLandingRouter(db, config));
  }

  // Admin dashboard — server-rendered Hono JSX (disabled by default).
  // Mounted before blob routes so /admin/* is claimed before /:sha256[.ext].
  // Runs on the main thread with direct database access — no Worker needed.
  if (config.dashboard.enabled) {
    app.route("/", buildAdminRouter(db, storage, config));
  }

  // BUD-09: PUT /report — blob reports (enabled by default, gated by config.report.enabled)
  // Mounted before blob routes so /report is not caught by /:filename.
  if (config.report.enabled) {
    app.route("/", buildReportRouter(db, config));
  }

  // BUD-02 + BUD-06: PUT /upload, HEAD /upload
  // Mounted before the blob route so HEAD /upload is not caught by HEAD /:filename.
  app.route("/", buildUploadRouter(db, storage, config));

  // BUD-04: PUT /mirror
  app.route("/", buildMirrorRouter(db, storage, config));

  // BUD-05: PUT /media, HEAD /media
  // Mounted after /mirror and before /delete so it doesn't interfere with exact paths.
  app.route("/", buildMediaRouter(db, storage, config));

  // BUD-02: DELETE /:sha256
  app.route("/", buildDeleteRouter(db, storage, config));

  // BUD-02: GET /list/:pubkey (disabled by default — spec marks it unrecommended)
  // Mounted before the blob route so /list/:pubkey is not caught by GET /:filename.
  app.route("/", buildListRouter(db, config));

  // BUD-01: GET/HEAD /:sha256[.ext]
  // Mounted after /upload, /mirror, /delete, /list so those exact paths take priority.
  app.route("/", buildBlobsRouter(db, storage, config));

  return app;
}
