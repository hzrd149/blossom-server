/**
 * Assembles the Hono application and wires all routes and middleware.
 * Called once at startup with a fully-loaded config.
 */

import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { serveStatic } from "@hono/hono/deno";
import type { Client } from "@libsql/client";
import type { IBlobStorage } from "./storage/interface.ts";
import type { Config } from "./config/schema.ts";

import { corsMiddleware } from "./middleware/cors.ts";
import { authMiddleware } from "./middleware/auth.ts";
import type { BlossomVariables } from "./middleware/auth.ts";
import { onError } from "./middleware/errors.ts";
import { requestLogger } from "./middleware/logger.ts";
import { clientIpMiddleware } from "./middleware/client-ip.ts";
import { envelopeAdmissionMiddleware } from "./middleware/envelope.ts";

import { buildBlossomRouter } from "./routes/blossom-router.ts";
import { buildLandingRouter, PUBLIC_DIR, warnIfStylesheetMissing } from "./routes/landing.tsx";
import { isStaticCandidate } from "./utils/url.ts";
import type { HttpMetrics } from "./metrics/http.ts";
import { createServerRuntime, type ServerRuntime } from "./runtime.ts";

export interface BuildAppOptions {
  staticMiddleware?: MiddlewareHandler;
  metrics?: HttpMetrics;
  /** Live server state. When omitted, a runtime is created from config with a stopped prune scheduler. */
  runtime?: ServerRuntime;
  /** Path of the loaded config file. The admin console reads and (when writable) rewrites its storage.rules. When omitted, the console can only generate a config for copying. */
  configPath?: string;
}

export async function buildApp(
  db: Client,
  storage: IBlobStorage,
  config: Config,
  options: BuildAppOptions = {},
): Promise<Hono<{ Variables: BlossomVariables }>> {
  const app = new Hono<{ Variables: BlossomVariables }>();
  const runtime = options.runtime ?? await createServerRuntime(db, storage, config);

  // Global fallback error handler — preserves pre-built responses on
  // HTTPException (e.g. basicAuth's WWW-Authenticate header). Blossom-specific
  // X-Reason formatting is handled by the Blossom sub-app's own onError.
  app.onError(onError);

  if (options.metrics) app.use("*", options.metrics.middleware);

  // Request/response logging
  app.use("*", requestLogger);

  // Resolve the client address (trusted-proxy aware) for enforcement and activity logging.
  app.use("*", clientIpMiddleware(config.network));

  // Administration owns its entire namespace before public static files and
  // Blossom-specific middleware. Disabled administration cannot leak assets.
  if (config.dashboard.enabled) {
    const [{ buildAdminApp }, { createManagementServices }] = await Promise.all([
      import("./admin/server/app.ts"),
      import("./admin/services/index.ts"),
    ]);
    app.route("/admin", buildAdminApp({ config, services: createManagementServices(db, storage, config, runtime, options.configPath) }));
  } else {
    app.all("/admin", (c) => c.notFound());
    app.all("/admin/*", (c) => c.notFound());
  }

  // BUD-01: CORS headers on all responses + OPTIONS preflight
  app.use("*", corsMiddleware);

  // BUD-02/05: reject encoded upload envelopes before auth or body processing
  app.use("*", envelopeAdmissionMiddleware());

  // BUD-11: validate supplied auth headers; missing credentials pass through.
  app.use("*", authMiddleware(config.publicDomain));

  // Serve any file from the public directory at its root-relative URL.
  // Requests that do not map to a file fall through to the app routes below.
  const staticMiddleware = options.staticMiddleware ?? serveStatic({
    root: PUBLIC_DIR,
    onFound: (_path, ctx) => {
      // Public assets have stable, unversioned URLs and may change on deployment.
      ctx.header("Cache-Control", "no-cache");
    },
  });
  app.use("*", async (ctx, next) => {
    const pathname = new URL(ctx.req.url).pathname;
    if (!isStaticCandidate(pathname)) return next();
    // Encoded spellings must not expose public/admin outside its authenticated router.
    if (decodeURIComponent(pathname).split("/")[1] === "admin") return ctx.notFound();
    return await staticMiddleware(ctx, next);
  });

  if (config.landing.enabled) {
    await warnIfStylesheetMissing();
  }

  // Landing page: GET / and GET /client.js (disabled by default)
  // Mounted first so GET / is claimed before the Blossom blob catch-all.
  // buildLandingRouter is async — it loads the prebuilt client JS at startup.
  if (config.landing.enabled) {
    app.route("/", await buildLandingRouter(db, config, runtime));
  }

  // Blossom protocol routes (BUDs 01/02/04/05/06/09) — collected in a single
  // sub-app with its own BUD-01-compliant onError (text/plain + X-Reason).
  app.route("/", buildBlossomRouter(db, storage, config, runtime));

  return app;
}
