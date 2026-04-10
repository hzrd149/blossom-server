/**
 * E2E tests verifying X-Reason header presence on error responses (ERRF-01).
 *
 * These tests exercise error paths across multiple endpoint categories:
 *   - GET /<sha256> (blobs) — 404
 *   - PUT /upload — 411, 413
 *   - HEAD /media — 413
 *   - GET /list/:pubkey — 400
 *
 * X-Reason is set by:
 *   - errorResponse() in src/middleware/errors.ts — all direct error returns
 *   - blossom-router onError in src/routes/blossom-router.ts — HTTPException + unhandled errors
 *
 * ERRF-02 audit: No server-side code reads X-Reason for control flow. See SUMMARY.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { initDb } from "../../src/db/client.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";
import { buildApp } from "../../src/server.ts";
import { ConfigSchema } from "../../src/config/schema.ts";
import type { Hono } from "@hono/hono";
import type { BlossomVariables } from "../../src/middleware/auth.ts";

// ---------------------------------------------------------------------------
// Shared server state
// ---------------------------------------------------------------------------

const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;
let app: Hono<{ Variables: BlossomVariables }>;
let tmpDir: string;
let cleanup: () => Promise<void>;

// ---------------------------------------------------------------------------
// Setup — initialize shared server with all endpoints enabled, no auth
// ---------------------------------------------------------------------------

Deno.test({
  name: "x-reason e2e setup: initialize shared server",
  async fn() {
    tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_xreason_" });
    const dbPath = join(tmpDir, "test.db");
    const storageDir = join(tmpDir, "blobs");
    const dbConfig = { path: dbPath };

    const db = await initDb(dbConfig);
    const storage = new LocalStorage(storageDir);
    await storage.setup();
    const pool = initPool(1, 4, 500, db, dbConfig);

    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: false, enabled: true },
      media: { enabled: true, requireAuth: false, maxSize: 10_000_000 },
      list: { enabled: true, requireAuth: false, allowListOthers: true },
    });

    app = await buildApp(db, storage, config);

    cleanup = async () => {
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    };
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Test cases — each verifies X-Reason header is present and non-empty
// ---------------------------------------------------------------------------

Deno.test({
  name: "X-Reason: GET non-existent blob returns X-Reason header",
  async fn() {
    const res = await app.fetch(new Request(`http://localhost/${"f".repeat(64)}`));
    assertEquals(res.status, 404);
    const reason = res.headers.get("X-Reason");
    assertNotEquals(reason, null, "X-Reason header must be present on 404");
    assertNotEquals(reason, "", "X-Reason header must be non-empty");
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "X-Reason: PUT /upload missing Content-Length returns X-Reason header",
  async fn() {
    const res = await app.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(10),
      }),
    );
    // Should get 411 (Length Required) with X-Reason
    const reason = res.headers.get("X-Reason");
    assertNotEquals(reason, null, "X-Reason header must be present on error");
    assertNotEquals(reason, "", "X-Reason header must be non-empty");
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "X-Reason: HEAD /media oversized returns X-Reason header",
  async fn() {
    const res = await app.fetch(
      new Request("http://localhost/media", {
        method: "HEAD",
        headers: { "X-Content-Length": "999999999" },
      }),
    );
    assertEquals(res.status, 413);
    const reason = res.headers.get("X-Reason");
    assertNotEquals(reason, null, "X-Reason header must be present on 413");
    assertNotEquals(reason, "", "X-Reason header must be non-empty");
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "X-Reason: PUT /upload oversized returns X-Reason header",
  async fn() {
    // Default upload maxSize is 2 GB (2,147,483,648 bytes).
    // Use a value larger than 2 GB to trigger 413.
    const oversizedBytes = String(3 * 1024 * 1024 * 1024); // 3 GB
    const body = new Uint8Array(10);
    const res = await app.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: {
          "Content-Length": oversizedBytes,
          "Content-Type": "application/octet-stream",
        },
        body: body.slice(),
      }),
    );
    assertEquals(res.status, 413);
    const reason = res.headers.get("X-Reason");
    assertNotEquals(reason, null, "X-Reason header must be present on 413");
    assertNotEquals(reason, "", "X-Reason header must be non-empty");
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "X-Reason: GET /list invalid limit returns X-Reason header",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost/list/${"a".repeat(64)}?limit=-1`),
    );
    assertEquals(res.status, 400);
    const reason = res.headers.get("X-Reason");
    assertNotEquals(reason, null, "X-Reason header must be present on 400");
    assertNotEquals(reason, "", "X-Reason header must be non-empty");
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

Deno.test({
  name: "x-reason e2e teardown: cleanup",
  async fn() {
    await cleanup();
  },
  ...testOpts,
});
