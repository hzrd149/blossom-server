/** @jsxImportSource hono/jsx */

/**
 * Landing page router — runs on the main thread.
 *
 * Renders GET / via Hono JSX SSR and serves the pre-built client bundle
 * at GET /assets/client.js (lazy-loaded from disk on first request, then cached).
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { Config } from "../config/schema.ts";
import { DirectDbHandle } from "../db/direct.ts";
import { LandingPage } from "../landing/page.tsx";

export function buildLandingRouter(db: Client, config: Config): Hono {
  const handle = new DirectDbHandle(db);
  let cachedBundle: string | null = null;

  const app = new Hono();

  app.get("/", (c) => {
    return c.html(<LandingPage db={handle} config={config} />);
  });

  app.get("/assets/client.js", async (c) => {
    if (!cachedBundle) {
      cachedBundle = await Deno.readTextFile("./landing/dist/assets/client.js");
    }
    return c.text(cachedBundle, 200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
    });
  });

  return app;
}
