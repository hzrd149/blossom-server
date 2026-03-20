/// <reference lib="deno.worker" />
/** @jsxImportSource hono/jsx */
/**
 * Admin Worker — runs in a dedicated Deno Worker (separate V8 isolate).
 *
 * Owns its own Hono JSX app and serves:
 *   GET  /admin                         → redirect to /admin/blobs
 *   GET  /admin/blobs                   → BlobsPage SSR
 *   GET  /admin/blobs/:sha256           → BlobDetailPage SSR
 *   GET  /admin/users                   → UsersPage SSR
 *   GET  /admin/rules                   → RulesPage SSR
 *   GET  /admin/reports                 → ReportsPage SSR
 *   GET  /admin/reports/:id             → ReportDetailPage SSR
 *   DELETE /admin/api/blobs/:sha256     → force-delete blob
 *   POST   /admin/api/reports/:id/dismiss    → dismiss report
 *   POST   /admin/api/reports/:id/delete-blob → delete blob + all reports for it
 *
 * DB access is provided by the main thread via a DbProxy over a persistent
 * MessageChannel, using the same bridge pattern as the landing/upload workers.
 *
 * Storage adapter: the worker constructs its own IBlobStorage from the
 * serialized storage config passed at init — allowing it to call remove()
 * directly without an additional message-passing layer.
 *
 * Message protocol:
 *   IN  (once at init): { type: "init", dbPort: MessagePort, config: Config }
 *   IN  (per request):  { type: "request", id: string, method: string, url: string, headers: [string,string][] }
 *   OUT (once):         { type: "ready" }
 *   OUT (per request):  { type: "response", id: string, status: number, headers: [string,string][], body: string }
 */

import { Hono } from "@hono/hono";
import { basicAuth } from "@hono/hono/basic-auth";
import { DbProxy } from "../db/proxy.ts";
import { LocalStorage } from "../storage/local.ts";
import { S3Storage } from "../storage/s3.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import { mimeToExt } from "../utils/mime.ts";
import type { Config } from "../config/schema.ts";
import { BlobsPage } from "../admin/blobs-page.tsx";
import { BlobDetailPage } from "../admin/blob-detail-page.tsx";
import { UsersPage } from "../admin/users-page.tsx";
import { RulesPage } from "../admin/rules-page.tsx";
import { ReportsPage } from "../admin/reports-page.tsx";
import { ReportDetailPage } from "../admin/report-detail-page.tsx";

// ---------------------------------------------------------------------------
// Message types (identical shape to landing-worker)
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

  // Build storage adapter from config so this worker can call remove()
  let storage: IBlobStorage;
  if (config.storage.backend === "local") {
    const dir = config.storage.local?.dir ?? "./data/blobs";
    const local = new LocalStorage(dir);
    await local.setup();
    storage = local;
  } else {
    const s3Cfg = config.storage.s3!;
    storage = new S3Storage({
      endpoint: s3Cfg.endpoint,
      bucket: s3Cfg.bucket,
      accessKey: s3Cfg.accessKey,
      secretKey: s3Cfg.secretKey,
      region: s3Cfg.region,
      publicURL: s3Cfg.publicURL,
      tmpDir: s3Cfg.tmpDir,
    });
  }

  // ── Build Hono app ─────────────────────────────────────────────────────────

  const app = new Hono();

  // HTTP Basic Auth gate on all /admin/* routes
  app.use("/admin/*", basicAuth({ username: config.dashboard.username, password: config.dashboard.password }));

  // ── SSR pages ──────────────────────────────────────────────────────────────

  app.get("/admin", (c) => c.redirect("/admin/blobs", 301));

  app.get("/admin/blobs", (c) => {
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
    const q = c.req.query("q") ?? "";
    const host = c.req.header("host") ?? "localhost";
    return c.html(<BlobsPage db={db} config={config} host={host} page={page} q={q} />);
  });

  app.get("/admin/blobs/:sha256", (c) => {
    const sha256 = c.req.param("sha256");
    const host = c.req.header("host") ?? "localhost";
    return c.html(<BlobDetailPage db={db} config={config} host={host} sha256={sha256} />);
  });

  app.get("/admin/users", (c) => {
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
    const q = c.req.query("q") ?? "";
    return c.html(<UsersPage db={db} page={page} q={q} />);
  });

  app.get("/admin/rules", (c) => {
    return c.html(<RulesPage config={config} />);
  });

  app.get("/admin/reports", (c) => {
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
    const typeFilter = c.req.query("type") ?? "";
    return c.html(<ReportsPage db={db} page={page} typeFilter={typeFilter} />);
  });

  app.get("/admin/reports/:id", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid report id" }, 400);
    return c.html(<ReportDetailPage db={db} reportId={id} />);
  });

  // ── JSON action endpoints ──────────────────────────────────────────────────

  // DELETE /admin/api/blobs/:sha256 — force-delete a blob
  app.delete("/admin/api/blobs/:sha256", async (c) => {
    const sha256 = c.req.param("sha256");
    const blob = await db.getBlob(sha256);
    const ext = blob ? mimeToExt(blob.type) : "";

    await db.deleteBlob(sha256);

    await storage
      .remove(sha256, ext)
      .catch((err) => console.warn(`[admin] Failed to remove blob ${sha256} from storage:`, err));

    return c.json({ success: true }, 200);
  });

  // POST /admin/api/reports/:id/dismiss — dismiss report only (keep blob)
  app.post("/admin/api/reports/:id/dismiss", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid report id" }, 400);

    const deleted = await db.deleteReport(id);
    if (!deleted) return c.json({ error: "Report not found" }, 404);

    return c.json({ success: true }, 200);
  });

  // POST /admin/api/reports/:id/delete-blob — delete blob + dismiss all its reports
  app.post("/admin/api/reports/:id/delete-blob", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid report id" }, 400);

    const report = await db.getReport(id);
    if (!report) return c.json({ error: "Report not found" }, 404);

    const blobHash = report.blob;
    const blob = await db.getBlob(blobHash);
    const ext = blob ? mimeToExt(blob.type) : "";

    await db.deleteBlob(blobHash);

    await storage
      .remove(blobHash, ext)
      .catch((err) => console.warn(`[admin] Failed to remove blob ${blobHash} from storage:`, err));

    await db.deleteReportsByBlob(blobHash);

    return c.json({ success: true }, 200);
  });

  // Signal ready to the main thread
  self.postMessage({ type: "ready" } satisfies ReadyMessage);

  // Switch to request handler
  self.onmessage = async (event: MessageEvent<RequestMessage>) => {
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
