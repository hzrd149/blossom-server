/// <reference lib="deno.worker" />
/** @jsxImportSource hono/jsx */
/**
 * Landing Worker — runs in a dedicated Deno Worker (separate V8 isolate).
 *
 * Owns its own Hono JSX app and serves:
 *   GET /          → SSR landing page (reads live stats via DbProxy)
 *   GET /assets/client.js → pre-built hono/jsx/dom client bundle
 *
 * DB access is provided by the main thread via a DbProxy over a persistent
 * MessageChannel, using the same bridge pattern as the upload worker pool.
 *
 * Message protocol:
 *   IN  (once at init): { type: "init", dbPort: MessagePort, config: Config }
 *   IN  (per request):  { type: "request", id: string, method: string, url: string, headers: [string,string][] }
 *   OUT (once):         { type: "ready" }
 *   OUT (per request):  { type: "response", id: string, status: number, headers: [string,string][], body: string }
 */

import { Hono } from "@hono/hono";
import { DbProxy } from "../db/proxy.ts";
import { LandingPage } from "../landing/page.tsx";
import type { Config } from "../config/schema.ts";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface InitMessage {
  type: "init";
  dbPort: MessagePort;
  config: Config;
}

interface RequestMessage {
  type: "request";
  id: string;
  method: string;
  url: string;
  headers: [string, string][];
}

interface ReadyMessage {
  type: "ready";
}

interface ResponseMessage {
  type: "response";
  id: string;
  status: number;
  headers: [string, string][];
  body: string;
}

// ---------------------------------------------------------------------------
// Init handler — runs once, then switches to request handler
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<InitMessage | RequestMessage>) => {
  const msg = event.data;
  if (msg.type !== "init") return;

  const db = new DbProxy(msg.dbPort);
  const config = msg.config;

  // Read the pre-built client bundle from disk
  const bundlePath = new URL("../landing/client.bundle.js", import.meta.url);
  const clientBundle = await Deno.readTextFile(bundlePath);

  // Build the internal Hono app
  const app = new Hono();

  app.get("/", (c) => {
    return c.html(<LandingPage db={db} config={config} />);
  });

  app.get("/assets/client.js", (c) => {
    return c.body(clientBundle, 200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });

  // Signal ready to the main thread
  self.postMessage({ type: "ready" } satisfies ReadyMessage);

  // Switch to request handler
  self.onmessage = async (
    event: MessageEvent<RequestMessage>,
  ) => {
    const req = event.data;
    if (req.type !== "request") return;

    try {
      const request = new Request(req.url, {
        method: req.method,
        headers: req.headers,
      });

      const res = await app.fetch(request);
      const body = await res.text();

      self.postMessage({
        type: "response",
        id: req.id,
        status: res.status,
        headers: [...res.headers] as [string, string][],
        body,
      } satisfies ResponseMessage);
    } catch (err) {
      self.postMessage({
        type: "response",
        id: req.id,
        status: 500,
        headers: [["Content-Type", "text/plain"]],
        body: err instanceof Error ? err.message : "Internal error",
      } satisfies ResponseMessage);
    }
  };
};
