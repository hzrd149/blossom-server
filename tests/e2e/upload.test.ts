/**
 * E2E tests for PUT /upload (BUD-02) and HEAD /upload (BUD-06 preflight).
 *
 * Runs against a real Hono app with a real LibSQL DB, real local storage in a
 * temp dir, and a real upload worker pool (1 worker).
 *
 * All tests share one server instance to avoid pool singleton conflicts.
 * sanitizeOps/sanitizeResources are disabled because the worker pool uses
 * MessagePorts that outlive individual tests (by design — they're reused).
 */

import { assertEquals, assertMatch } from "@std/assert";
import { encodeBase64Url } from "@std/encoding/base64url";
import { encodeHex } from "@std/encoding/hex";
import { crypto as stdCrypto } from "@std/crypto";
import { join } from "@std/path";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";
import { initDb } from "../../src/db/client.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";
import { buildApp } from "../../src/server.ts";
import { ConfigSchema } from "../../src/config/schema.ts";
import type { Hono } from "@hono/hono";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sk = generateSecretKey();
const _pk = getPublicKey(sk);

/** Compute SHA-256 of bytes and return lowercase hex. */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await stdCrypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return encodeHex(new Uint8Array(buf));
}

/** Build a BUD-11 kind 24242 upload auth event. */
function makeUploadAuth(opts: {
  hash?: string; // x tag value — omit for open token
  expiration?: number;
  tTag?: string;
} = {}): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["t", opts.tTag ?? "upload"],
    ["expiration", String(opts.expiration ?? now + 600)],
  ];
  if (opts.hash) tags.push(["x", opts.hash]);
  return finalizeEvent({ kind: 24242, created_at: now, tags, content: "Upload blob" }, sk);
}

/** Encode event as Base64url for the Authorization header. */
function encodeAuth(event: NostrEvent): string {
  return `Nostr ${encodeBase64Url(new TextEncoder().encode(JSON.stringify(event)))}`;
}

// ---------------------------------------------------------------------------
// Shared server setup
//
// We use two shared app instances:
//   - appNoAuth: upload.requireAuth = false (for testing upload mechanics)
//   - appWithAuth: upload.requireAuth = true (for testing auth enforcement)
//
// Both share the same pool singleton (initPool is called once).
// ---------------------------------------------------------------------------

let appNoAuth: Hono;
let appWithAuth: Hono;
let tmpDir: string;
let cleanup: () => Promise<void>;

// Deno doesn't have a native beforeAll, so we use a setup test that runs first.
// All subsequent tests use sanitizeOps: false, sanitizeResources: false to avoid
// false leak warnings from the persistent MessagePort in the worker pool.
Deno.test({
  name: "e2e setup: initialize shared server",
  async fn() {
    tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_upload_" });
    const dbPath = join(tmpDir, "test.db");
    const storageDir = join(tmpDir, "blobs");
    const dbConfig = { path: dbPath };

    const db = await initDb(dbConfig);
    const storage = new LocalStorage(storageDir);
    await storage.setup();

    // Initialize the pool singleton once — shared across all tests in this file
    // Args: workers, maxJobsPerWorker, throughputWindowMs, db, dbConfig
    const pool = initPool(1, 4, 500, db, dbConfig);

    const configNoAuth = ConfigSchema.parse({
      publicDomain: "http://localhost",
      upload: { requireAuth: false, enabled: true },
    });
    const configWithAuth = ConfigSchema.parse({
      publicDomain: "http://localhost",
      upload: { requireAuth: true, enabled: true },
    });

    appNoAuth = buildApp(db, storage, storageDir, configNoAuth);
    appWithAuth = buildApp(db, storage, storageDir, configWithAuth);

    cleanup = async () => {
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    };
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

/** Convenience wrapper: send a request to the no-auth app. */
function fetchNoAuth(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(appNoAuth.fetch(new Request(`http://localhost${path}`, init)));
}

/** Convenience wrapper: send a request to the auth-required app. */
function fetchWithAuth(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(appWithAuth.fetch(new Request(`http://localhost${path}`, init)));
}

// Test options used for every test — suppress leak detection for the worker pool
const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

// ---------------------------------------------------------------------------
// PUT /upload — basic validation
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /upload: missing Content-Length returns 411",
  async fn() {
    const res = await fetchNoAuth("/upload", {
      method: "PUT",
      body: new Uint8Array([1, 2, 3]),
    });
    assertEquals(res.status, 411);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /upload: Content-Length exceeds maxSize returns 413",
  async fn() {
    const res = await fetchNoAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(200 * 1024 * 1024), // 200MB > default 100MB
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(0),
    });
    assertEquals(res.status, 413);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /upload: disallowed MIME type returns 415",
  async fn() {
    // Build a one-off app with restricted MIME types
    const restrictedStorageDir = join(tmpDir, "blobs-restricted");
    const restrictedDb = await initDb({ path: join(tmpDir, "restricted.db") });
    const restrictedStorage = new LocalStorage(restrictedStorageDir);
    await restrictedStorage.setup();
    const restrictedConfig = ConfigSchema.parse({
      publicDomain: "http://localhost",
      upload: { requireAuth: false, enabled: true, allowedTypes: ["image/*"] },
    });
    // Note: getPool() singleton is reused here — same pool, different config
    const restrictedApp = buildApp(restrictedDb, restrictedStorage, restrictedStorageDir, restrictedConfig);

    const body = new Uint8Array([1, 2, 3]);
    const res = await restrictedApp.fetch(new Request("http://localhost/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/pdf",
      },
      body,
    }));
    assertEquals(res.status, 415);
    await res.body?.cancel();
    restrictedDb.close();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// PUT /upload — auth enforcement
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /upload: no auth when required returns 401",
  async fn() {
    const body = new Uint8Array([1, 2, 3]);
    const res = await fetchWithAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
      },
      body,
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /upload: auth with wrong t tag returns 403",
  async fn() {
    const body = new Uint8Array([1, 2, 3]);
    const auth = makeUploadAuth({ tTag: "delete" });
    const res = await fetchWithAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
        "Authorization": encodeAuth(auth),
      },
      body,
    });
    assertEquals(res.status, 403);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// PUT /upload — successful upload
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /upload: successful upload returns 200 BlobDescriptor",
  async fn() {
    const body = new TextEncoder().encode("hello blossom");
    const expectedHash = await sha256Hex(body);

    const res = await fetchNoAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "text/plain",
      },
      body,
    });
    assertEquals(res.status, 200);

    const json = await res.json();
    assertEquals(json.sha256, expectedHash);
    assertEquals(json.size, body.byteLength);
    assertEquals(json.type, "text/plain");
    assertMatch(json.url, /http:\/\/localhost\//);
    assertMatch(json.url, new RegExp(expectedHash));
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /upload: with correct auth and open x-tag returns 200",
  async fn() {
    const body = new TextEncoder().encode("authenticated upload");
    // Open token — no x tags, permits any blob
    const auth = makeUploadAuth({});

    const res = await fetchWithAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "text/plain",
        "Authorization": encodeAuth(auth),
      },
      body,
    });
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(typeof json.sha256, "string");
    assertEquals(json.sha256.length, 64);
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// PUT /upload — X-SHA-256 hash verification
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /upload: matching X-SHA-256 returns 200",
  async fn() {
    const body = new TextEncoder().encode("verifiable content");
    const hash = await sha256Hex(body);

    const res = await fetchNoAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
        "X-SHA-256": hash,
      },
      body,
    });
    assertEquals(res.status, 200);

    const json = await res.json();
    assertEquals(json.sha256, hash);
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /upload: mismatched X-SHA-256 returns 400 with hash mismatch message",
  async fn() {
    const body = new TextEncoder().encode("real content");
    const wrongHash = "a".repeat(64);

    const res = await fetchNoAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
        "X-SHA-256": wrongHash,
      },
      body,
    });
    assertEquals(res.status, 400);

    // X-Reason header should contain mismatch info
    const reason = res.headers.get("X-Reason") ?? "";
    assertMatch(reason, /[Hh]ash mismatch|[Mm]ismatch/);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /upload: invalid X-SHA-256 format returns 400",
  async fn() {
    const body = new TextEncoder().encode("content");
    const res = await fetchNoAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
        "X-SHA-256": "not-a-valid-hash",
      },
      body,
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /upload: without X-SHA-256 computed hash is correct",
  async fn() {
    const body = new TextEncoder().encode("no declared hash");
    const expectedHash = await sha256Hex(body);

    const res = await fetchNoAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
      },
      body,
    });
    assertEquals(res.status, 200);

    const json = await res.json();
    // Even without X-SHA-256 the server MUST compute and return the correct hash
    assertEquals(json.sha256, expectedHash, "Computed hash must match actual content hash");
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// PUT /upload — x-tag enforcement (BUD-11)
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /upload: x-tagged auth with matching X-SHA-256 → 200",
  async fn() {
    const body = new TextEncoder().encode("x tag scoped upload");
    const hash = await sha256Hex(body);
    const auth = makeUploadAuth({ hash });

    const res = await fetchWithAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
        "X-SHA-256": hash,
        "Authorization": encodeAuth(auth),
      },
      body,
    });
    assertEquals(res.status, 200);
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /upload: x-tagged auth with non-matching X-SHA-256 → 403",
  async fn() {
    const body = new TextEncoder().encode("different content");
    const actualHash = await sha256Hex(body);
    const wrongHash = "b".repeat(64);

    // Token scoped to wrongHash, but we're declaring actualHash
    const auth = makeUploadAuth({ hash: wrongHash });

    const res = await fetchWithAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
        "X-SHA-256": actualHash,
        "Authorization": encodeAuth(auth),
      },
      body,
    });
    assertEquals(res.status, 403);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// PUT /upload — deduplication
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /upload: same content uploaded twice returns same descriptor (dedup)",
  async fn() {
    const body = new TextEncoder().encode("deduplicated content abc123");
    const hash = await sha256Hex(body);

    const doUpload = async () => {
      const res = await fetchNoAuth("/upload", {
        method: "PUT",
        headers: {
          "Content-Length": String(body.byteLength),
          "Content-Type": "application/octet-stream",
          "X-SHA-256": hash,
        },
        body: body.slice(),
      });
      assertEquals(res.status, 200);
      return res.json();
    };

    const json1 = await doUpload();
    const json2 = await doUpload();

    assertEquals(json1.sha256, json2.sha256);
    assertEquals(json1.url, json2.url);
    assertEquals(json1.size, json2.size);
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// HEAD /upload — BUD-06 preflight
// ---------------------------------------------------------------------------

Deno.test({
  name: "HEAD /upload: missing X-Content-Length returns 411",
  async fn() {
    const res = await fetchNoAuth("/upload", { method: "HEAD" });
    assertEquals(res.status, 411);
  },
  ...testOpts,
});

Deno.test({
  name: "HEAD /upload: X-Content-Length exceeds maxSize returns 413",
  async fn() {
    const res = await fetchNoAuth("/upload", {
      method: "HEAD",
      headers: { "X-Content-Length": String(200 * 1024 * 1024) },
    });
    assertEquals(res.status, 413);
  },
  ...testOpts,
});

Deno.test({
  name: "HEAD /upload: no auth when required returns 401",
  async fn() {
    const res = await fetchWithAuth("/upload", {
      method: "HEAD",
      headers: { "X-Content-Length": "100" },
    });
    assertEquals(res.status, 401);
  },
  ...testOpts,
});

Deno.test({
  name: "HEAD /upload: valid request returns 200",
  async fn() {
    const res = await fetchNoAuth("/upload", {
      method: "HEAD",
      headers: {
        "X-Content-Length": "100",
        "X-Content-Type": "application/octet-stream",
      },
    });
    assertEquals(res.status, 200);
  },
  ...testOpts,
});

Deno.test({
  name: "HEAD /upload: existing blob with X-SHA-256 returns 200 with dedup reason",
  async fn() {
    // Upload the blob first
    const body = new TextEncoder().encode("preflight dedup test xyz");
    const hash = await sha256Hex(body);

    const uploadRes = await fetchNoAuth("/upload", {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/octet-stream",
        "X-SHA-256": hash,
      },
      body,
    });
    assertEquals(uploadRes.status, 200);

    // Now preflight — should get 200 with X-Reason indicating dedup
    const res = await fetchNoAuth("/upload", {
      method: "HEAD",
      headers: {
        "X-Content-Length": String(body.byteLength),
        "X-Content-Type": "application/octet-stream",
        "X-SHA-256": hash,
      },
    });
    assertEquals(res.status, 200);
    const reason = res.headers.get("X-Reason") ?? "";
    assertMatch(reason, /[Dd]edup|already exists/);
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

Deno.test({
  name: "e2e teardown: shutdown shared server",
  async fn() {
    await cleanup();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
