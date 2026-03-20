/** @jsxImportSource hono/jsx */

/**
 * Landing page router — runs on the main thread.
 *
 * Renders GET / via Hono JSX SSR and serves the client bundle at GET /client.js.
 *
 * Bundle resolution strategy at startup:
 *  1. If public/client.js exists on disk — load it directly (fast path).
 *     Covers Docker images (pre-built in image) and subsequent restarts after
 *     a first-run build.
 *  2. If missing and Deno.bundle() is available (--unstable-bundle) — build
 *     from source, write the result to public/client.js for future restarts,
 *     and serve from memory.
 *  3. If missing and Deno.bundle() is unavailable — throw a clear error.
 *     Run `deno task build-landing` to produce the file before starting.
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { Config } from "../config/schema.ts";
import { DirectDbHandle } from "../db/direct.ts";
import { LandingPage } from "../landing/page.tsx";

const CLIENT_BUNDLE_PATH = "./public/client.js";

/** Resolve the client bundle, building it if the pre-built file is missing. */
async function buildClientBundle(): Promise<string> {
  // Fast path — pre-built file already on disk (Docker image or previous build).
  try {
    const bundle = await Deno.readTextFile(CLIENT_BUNDLE_PATH);
    console.log("[landing] client bundle loaded from public/client.js");
    return bundle;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    // File missing — fall through to build it.
  }

  // Deno.bundle() is available when --unstable-bundle is passed.
  // Access via cast since it is not in the stable type surface.
  const denoBundle = (Deno as unknown as Record<string, unknown>)["bundle"];
  if (typeof denoBundle !== "function") {
    throw new Error(
      "[landing] public/client.js not found and Deno.bundle() is unavailable. " +
        "Run `deno task build-landing` to pre-build it, or start the server with --unstable-bundle.",
    );
  }

  console.log("[landing] public/client.js not found — building from source via Deno.bundle()...");

  const bundleFn = denoBundle as (opts: unknown) => Promise<{ outputFiles?: { text(): string }[] }>;

  const result = await bundleFn({
    entrypoints: ["./src/landing/client/index.tsx"],
    platform: "browser",
    minify: true,
    write: false,
  });

  const file = result.outputFiles?.[0];
  if (!file) throw new Error("[landing] Deno.bundle() returned no output files");

  const bundle = file.text();

  // Write to disk so subsequent restarts use the fast path.
  try {
    await Deno.writeTextFile(CLIENT_BUNDLE_PATH, bundle);
    console.log("[landing] client bundle written to public/client.js");
  } catch (err) {
    // Non-fatal — the bundle is already in memory; serve it regardless.
    console.warn("[landing] could not write public/client.js:", err instanceof Error ? err.message : String(err));
  }

  return bundle;
}

export async function buildLandingRouter(db: Client, config: Config): Promise<Hono> {
  const handle = new DirectDbHandle(db);

  // Resolve the client bundle once at startup and hold it in memory.
  const clientBundle = await buildClientBundle();

  const app = new Hono();

  app.get("/", (c) => {
    return c.html(<LandingPage db={handle} config={config} />);
  });

  app.get("/client.js", (c) => {
    return c.text(clientBundle, 200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
    });
  });

  return app;
}
