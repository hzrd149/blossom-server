/** @jsxImportSource hono/jsx */

/**
 * Landing page router — runs on the main thread.
 *
 * Renders GET / via Hono JSX SSR and serves the client bundle at GET /assets/client.js.
 *
 * Bundle resolution strategy (in priority order):
 *  1. Deno.bundle() runtime API — builds from source in memory at startup, no disk file needed.
 *     Requires --unstable-bundle flag.
 *  2. Pre-built file fallback — reads landing/dist/assets/client.js from disk.
 *     Used when --unstable-bundle is not set, or in Docker/CI where the file is pre-built.
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { Config } from "../config/schema.ts";
import { DirectDbHandle } from "../db/direct.ts";
import { LandingPage } from "../landing/page.tsx";

/** Resolve the client bundle — tries Deno.bundle() first, falls back to disk. */
async function buildClientBundle(): Promise<string> {
  // Deno.bundle() is available when --unstable-bundle is passed.
  // Access via cast since it is not in the stable type surface.
  const denoBundle = (Deno as unknown as Record<string, unknown>)["bundle"];
  if (typeof denoBundle === "function") {
    try {
      const bundleFn = denoBundle as (
        opts: unknown,
      ) => Promise<{ outputFiles?: { text(): string }[] }>;
      const result = await bundleFn({
        entrypoints: ["./landing/src/client.tsx"],
        platform: "browser",
        minify: true,
        write: false,
      });
      const file = result.outputFiles?.[0];
      if (file) {
        console.log(
          "[landing] client bundle built in memory via Deno.bundle()",
        );
        return file.text();
      }
    } catch (err) {
      console.warn(
        "[landing] Deno.bundle() failed, falling back to pre-built file:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Fall back to the pre-built artifact from `deno task build-landing`.
  const bundle = await Deno.readTextFile("./landing/dist/assets/client.js");
  console.log(
    "[landing] client bundle loaded from landing/dist/assets/client.js",
  );
  return bundle;
}

export async function buildLandingRouter(
  db: Client,
  config: Config,
): Promise<Hono> {
  const handle = new DirectDbHandle(db);

  // Build (or load) the client bundle once at startup and hold it in memory.
  const clientBundle = await buildClientBundle();

  const app = new Hono();

  app.get("/", (c) => {
    return c.html(<LandingPage db={handle} config={config} />);
  });

  app.get("/assets/client.js", (c) => {
    return c.text(clientBundle, 200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
    });
  });

  return app;
}
