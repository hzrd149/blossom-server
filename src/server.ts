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
import { buildLandingRouter } from "./routes/landing.ts";
import { buildAdminRouter } from "./routes/admin.ts";

export function buildApp(
  db: Client,
  storage: IBlobStorage,
  config: Config,
  landingWorker?: Worker,
  adminPassword?: string,
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

  // Landing page: GET / and GET /assets/client.js (disabled by default)
  // Mounted first so GET / is claimed before the blob regex route.
  if (config.landing.enabled && landingWorker) {
    app.route("/", buildLandingRouter(landingWorker));
  }

  // Admin dashboard API + static SPA (disabled by default)
  // Mounted first so /api/* and /admin/* are claimed before blob routes.
  if (config.dashboard.enabled && adminPassword) {
    app.route("/", buildAdminRouter(db, storage, config, adminPassword));

    // Serve the pre-built React Admin SPA and its assets.
    // The bundle's index.html references assets at /admin/assets/<file>.
    // We handle three cases:
    //   1. /admin/assets/* — serve the hashed JS bundle
    //   2. /admin          — redirect to /admin/ so relative asset paths resolve
    //   3. /admin/*        — serve index.html (SPA catch-all for client-side routing)
    app.get("/admin/assets/:filename", async (c) => {
      const filename = c.req.param("filename");
      // Basic path safety — no directory traversal
      if (filename.includes("/") || filename.includes("..")) {
        return c.text("Not found", 404);
      }
      try {
        const file = await Deno.readFile(`./admin/dist/assets/${filename}`);
        const ext = filename.split(".").pop()?.toLowerCase();
        const contentType = ext === "js" ? "application/javascript"
          : ext === "css" ? "text/css"
          : "application/octet-stream";
        return c.body(file, 200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        });
      } catch {
        return c.text("Not found", 404);
      }
    });

    app.get("/admin", (c) => c.redirect("/admin/", 301));

    app.get("/admin/*", async (c) => {
      try {
        const html = await Deno.readTextFile("./admin/dist/index.html");
        return c.html(html);
      } catch {
        return c.text(
          "Admin UI not found. Run: deno task build-admin",
          503,
        );
      }
    });
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

  // BUD-01: GET/HEAD /:sha256[.ext]
  // Mounted after /upload, /mirror, /delete so those exact paths take priority.
  app.route("/", buildBlobsRouter(db, storage, config));

  return app;
}
