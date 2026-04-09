/**
 * E2E tests for DELETE /<sha256> (BUD-02/BUD-12).
 *
 * Runs against a real Hono app with a real LibSQL DB, real local storage in a
 * temp dir, and a real upload worker pool (1 worker).
 *
 * All tests share one server instance to avoid pool singleton conflicts.
 * sanitizeOps/sanitizeResources are disabled because the worker pool uses
 * MessagePorts that outlive individual tests (by design — they're reused).
 */

import { assertEquals } from "@std/assert";
import { encodeBase64Url } from "@std/encoding/base64url";
import { encodeHex } from "@std/encoding/hex";
import { crypto as stdCrypto } from "@std/crypto";
import { join } from "@std/path";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";
import { initDb } from "../../src/db/client.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";
import { buildApp } from "../../src/server.ts";
import { ConfigSchema } from "../../src/config/schema.ts";
import type { Hono } from "@hono/hono";
import type { BlossomVariables } from "../../src/middleware/auth.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sk = generateSecretKey();
const pk = getPublicKey(sk);

/** Compute SHA-256 of bytes and return lowercase hex. */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await stdCrypto.subtle.digest(
    "SHA-256",
    data.buffer as ArrayBuffer,
  );
  return encodeHex(new Uint8Array(buf));
}

/** Build a BUD-11 kind 24242 delete auth event for a given hash and secret key. */
function makeDeleteAuth(hash: string, secretKey = sk): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  return finalizeEvent(
    {
      kind: 24242,
      created_at: now,
      tags: [
        ["t", "delete"],
        ["expiration", String(now + 600)],
        ["x", hash],
      ],
      content: "Delete blob",
    },
    secretKey,
  );
}

/** Encode a Nostr event as Base64url for the Authorization header. */
function encodeAuth(event: NostrEvent): string {
  return `Nostr ${
    encodeBase64Url(new TextEncoder().encode(JSON.stringify(event)))
  }`;
}

/** Build a BUD-11 kind 24242 upload auth event (open token). */
function makeUploadAuth(secretKey = sk): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  return finalizeEvent(
    {
      kind: 24242,
      created_at: now,
      tags: [
        ["t", "upload"],
        ["expiration", String(now + 600)],
      ],
      content: "Upload blob",
    },
    secretKey,
  );
}

// ---------------------------------------------------------------------------
// Shared server setup
// ---------------------------------------------------------------------------

let appWithAuth: Hono<{ Variables: BlossomVariables }>;
let tmpDir: string;
let blobHash: string;
let cleanup: () => Promise<void>;

// Deno doesn't have a native beforeAll, so we use a setup test that runs first.
// All subsequent tests use sanitizeOps: false, sanitizeResources: false to avoid
// false leak warnings from the persistent MessagePort in the worker pool.
Deno.test({
  name: "e2e setup: initialize shared delete server",
  async fn() {
    tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_delete_" });
    const dbPath = join(tmpDir, "test.db");
    const storageDir = join(tmpDir, "blobs");
    const dbConfig = { path: dbPath };

    const db = await initDb(dbConfig);
    const storage = new LocalStorage(storageDir);
    await storage.setup();

    // Initialize the pool singleton once — shared across all tests in this file
    const pool = initPool(1, 4, 500, db, dbConfig);

    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: true, enabled: true },
      delete: { requireAuth: true },
    });

    appWithAuth = await buildApp(db, storage, config);

    // Upload a test blob owned by `sk` so we can test deletion
    const blobData = new TextEncoder().encode("delete test blob content");
    blobHash = await sha256Hex(blobData);
    const uploadAuth = makeUploadAuth();

    const uploadRes = await appWithAuth.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: {
          "Content-Length": String(blobData.byteLength),
          "Content-Type": "text/plain",
          Authorization: encodeAuth(uploadAuth),
        },
        body: blobData,
      }),
    );
    assertEquals(uploadRes.status, 201, "Setup upload must succeed");
    await uploadRes.body?.cancel();

    cleanup = async () => {
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    };
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// Test options used for every test — suppress leak detection for the worker pool
const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

// ---------------------------------------------------------------------------
// DELETE /<sha256> — status code tests
// ---------------------------------------------------------------------------

Deno.test({
  name: "DELETE blob: non-existent hash returns 404",
  async fn() {
    const nonExistentHash = "f".repeat(64);
    const auth = makeDeleteAuth(nonExistentHash);
    const res = await appWithAuth.fetch(
      new Request(`http://localhost/${nonExistentHash}`, {
        method: "DELETE",
        headers: { Authorization: encodeAuth(auth) },
      }),
    );
    assertEquals(res.status, 404);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "DELETE blob: invalid hash format returns 400",
  async fn() {
    const auth = makeDeleteAuth("not-a-valid-hash");
    const res = await appWithAuth.fetch(
      new Request("http://localhost/not-a-valid-hash", {
        method: "DELETE",
        headers: { Authorization: encodeAuth(auth) },
      }),
    );
    assertEquals(res.status, 400);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "DELETE blob: missing auth when required returns 401",
  async fn() {
    // Upload a fresh blob so it exists in the DB
    const freshData = new TextEncoder().encode("auth required test blob xyz");
    const freshHash = await sha256Hex(freshData);
    const uploadAuth = makeUploadAuth();

    const uploadRes = await appWithAuth.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: {
          "Content-Length": String(freshData.byteLength),
          "Content-Type": "text/plain",
          Authorization: encodeAuth(uploadAuth),
        },
        body: freshData,
      }),
    );
    assertEquals(uploadRes.status, 201, "Pre-test upload must succeed");
    await uploadRes.body?.cancel();

    // Now try to DELETE without any Authorization header
    const res = await appWithAuth.fetch(
      new Request(`http://localhost/${freshHash}`, {
        method: "DELETE",
        // No Authorization header
      }),
    );
    assertEquals(res.status, 401);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "DELETE blob: non-owner returns 403",
  async fn() {
    // Upload a blob with sk2 (second key)
    const sk2 = generateSecretKey();
    const blobData2 = new TextEncoder().encode("non-owner test blob abc");
    const hash2 = await sha256Hex(blobData2);
    const uploadAuth2 = makeUploadAuth(sk2);

    const uploadRes = await appWithAuth.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: {
          "Content-Length": String(blobData2.byteLength),
          "Content-Type": "text/plain",
          Authorization: encodeAuth(uploadAuth2),
        },
        body: blobData2,
      }),
    );
    assertEquals(uploadRes.status, 201, "Pre-test upload must succeed");
    await uploadRes.body?.cancel();

    // Try to DELETE with sk (original key) — not the owner of this blob
    const deleteAuth = makeDeleteAuth(hash2, sk);
    const res = await appWithAuth.fetch(
      new Request(`http://localhost/${hash2}`, {
        method: "DELETE",
        headers: { Authorization: encodeAuth(deleteAuth) },
      }),
    );
    assertEquals(res.status, 403);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "DELETE blob: successful deletion returns 204 with empty body",
  async fn() {
    const auth = makeDeleteAuth(blobHash);
    const res = await appWithAuth.fetch(
      new Request(`http://localhost/${blobHash}`, {
        method: "DELETE",
        headers: { Authorization: encodeAuth(auth) },
      }),
    );
    assertEquals(res.status, 204);
    const body = await res.text();
    assertEquals(body, "");
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

Deno.test({
  name: "e2e teardown: shutdown shared delete server",
  async fn() {
    await cleanup();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
