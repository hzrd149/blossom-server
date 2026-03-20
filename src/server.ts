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

import { buildBlossomRouter } from "./routes/blossom-router.ts";
import { buildLandingRouter } from "./routes/landing.tsx";

export async function buildApp(
  db: Client,
  storage: IBlobStorage,
  config: Config,
): Promise<Hono> {
  const app = new Hono();

  // Global fallback error handler — preserves pre-built responses on
  // HTTPException (e.g. basicAuth's WWW-Authenticate header). Blossom-specific
  // X-Reason formatting is handled by the Blossom sub-app's own onError.
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

  // Landing page: GET / and GET /client.js (disabled by default)
  // Mounted first so GET / is claimed before the Blossom blob catch-all.
  // buildLandingRouter is async — it bundles (or loads) the client JS at startup.
  if (config.landing.enabled) {
    app.route("/", await buildLandingRouter(db, config));
  }

  // Admin dashboard — server-rendered Hono JSX, HTTP Basic Auth protected.
  // Dynamically imported so nostr-profile.ts (EventStore, RelayPool, loader)
  // is only initialised when the dashboard is actually enabled.
  if (config.dashboard.enabled) {
    const { buildAdminRouter } = await import("./routes/admin-router.tsx");
    app.route("/admin", buildAdminRouter(db, storage, config));
  }

  // Blossom protocol routes (BUDs 01/02/04/05/06/09) — collected in a single
  // sub-app with its own BUD-01-compliant onError (text/plain + X-Reason).
  app.route("/", buildBlossomRouter(db, storage, config));

  return app;
}
