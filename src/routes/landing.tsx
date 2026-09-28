/**
 * Landing page router — runs on the main thread.
 *
 * Renders GET / via Hono JSX SSR.
 *
 * Generated UI assets are served from public/ by the top-level app. Missing
 * assets produce startup warnings so blob APIs remain available.
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import { fromFileUrl, join } from "@std/path";
import type { Config } from "../config/schema.ts";
import { DirectDbHandle } from "../db/direct.ts";
import { LandingPage } from "../landing/page.tsx";

export const PUBLIC_DIR = fromFileUrl(new URL("../../public", import.meta.url));
const CLIENT_BUNDLE_PATH = join(PUBLIC_DIR, "client.js");
const STYLESHEET_PATH = join(PUBLIC_DIR, "styles.css");

/** Warn when the UI stylesheet is unavailable without blocking API startup. */
export async function warnIfStylesheetMissing(
  path = STYLESHEET_PATH,
): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) {
      console.warn(
        `[ui] ${path} exists but is not a file; pages will be unstyled until \`deno task build\` is run.`,
      );
      return false;
    }
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.warn(
        `[ui] ${path} not found; pages will be unstyled until \`deno task build\` is run.`,
      );
      return false;
    }
    throw err;
  }
}

/** Warn at startup if the prebuilt landing client bundle is missing. */
async function warnIfClientBundleMissing(): Promise<void> {
  try {
    const stat = await Deno.stat(CLIENT_BUNDLE_PATH);
    if (!stat.isFile) {
      console.warn(
        "[landing] public/client.js exists but is not a file; GET /client.js will not be available.",
      );
      return;
    }
    console.log("[landing] client bundle found at public/client.js");
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.warn(
        "[landing] public/client.js not found; GET /client.js will return 404 until the bundle is built.",
      );
      return;
    }
    throw err;
  }
}

export async function buildLandingRouter(
  db: Client,
  config: Config,
): Promise<Hono> {
  const handle = new DirectDbHandle(db);

  await warnIfClientBundleMissing();

  const app = new Hono();

  app.get("/", (c) => {
    return c.html(<LandingPage db={handle} config={config} />);
  });

  return app;
}
