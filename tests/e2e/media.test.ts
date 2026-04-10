/**
 * E2E tests for PUT /media (BUD-05) and HEAD /media (BUD-06-style preflight).
 *
 * Runs against a real Hono app with a real LibSQL DB, real local storage in a
 * temp dir, and a real upload worker pool (1 worker).
 *
 * All tests share one server instance to avoid pool singleton conflicts.
 * sanitizeOps/sanitizeResources are disabled because the worker pool uses
 * MessagePorts that outlive individual tests (by design — they're reused).
 *
 * Tests use a restricted storage config (image/* and video/* only) so that
 * application/x-executable triggers 415 Unsupported Media Type.
 */

import { assertEquals, assertMatch } from "@std/assert";
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
const _pk = getPublicKey(sk);

/** Compute SHA-256 of bytes and return lowercase hex. */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await stdCrypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return encodeHex(new Uint8Array(buf));
}

/** Build a BUD-11 kind 24242 media auth event. */
function makeMediaAuth(opts: { hash?: string; expiration?: number } = {}): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["t", "media"],
    ["expiration", String(opts.expiration ?? now + 600)],
  ];
  if (opts.hash) tags.push(["x", opts.hash]);
  return finalizeEvent({ kind: 24242, created_at: now, tags, content: "Upload media" }, sk);
}

/** Encode event as Base64url for the Authorization header. */
function encodeAuth(event: NostrEvent): string {
  return `Nostr ${encodeBase64Url(new TextEncoder().encode(JSON.stringify(event)))}`;
}

// ---------------------------------------------------------------------------
// Shared server setup
// ---------------------------------------------------------------------------

// Test options used for every test — suppress leak detection for the worker pool
const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

let app: Hono<{ Variables: BlossomVariables }>;
let tmpDir: string;
let cleanup: () => Promise<void>;

Deno.test({
  name: "media e2e setup: initialize shared server",
  async fn() {
    tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_media_" });
    const dbPath = join(tmpDir, "test.db");
    const storageDir = join(tmpDir, "blobs");
    const dbConfig = { path: dbPath };

    const db = await initDb(dbConfig);
    const storage = new LocalStorage(storageDir);
    await storage.setup();

    // Initialize the pool singleton once — shared across all tests in this file
    const pool = initPool(1, 4, 500, db, dbConfig);

    // Use restricted storage rules so application/x-executable triggers 415
    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      storage: {
        rules: [
          { type: "image/*", expiration: "1 month" },
          { type: "video/*", expiration: "1 week" },
        ],
      },
      upload: { requireAuth: false, enabled: true },
      media: {
        enabled: true,
        requireAuth: false,
        maxSize: 10_000_000,
      },
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
// PUT /media — hash mismatch (409)
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /media: mismatched X-SHA-256 returns 409 Conflict",
  async fn() {
    // Use a minimal valid PNG so the upload reaches the worker.
    // The worker computes the real hash and rejects because X-SHA-256 is wrong.
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, // 8bit RGB
      0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
      0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
      0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
      0xae, 0x42, 0x60, 0x82,
    ]);
    const realHash = await sha256Hex(pngHeader);
    const wrongHash = "c".repeat(64);
    // Auth must include the real hash in x tag (media requires x tags)
    const auth = makeMediaAuth({ hash: realHash });

    const res = await app.fetch(
      new Request("http://localhost/media", {
        method: "PUT",
        headers: {
          "Content-Length": String(pngHeader.byteLength),
          "Content-Type": "image/png",
          "X-SHA-256": wrongHash,
          Authorization: encodeAuth(auth),
        },
        body: pngHeader.slice(),
      }),
    );
    assertEquals(res.status, 409);
    const reason = res.headers.get("X-Reason") ?? "";
    assertMatch(reason, /[Hh]ash mismatch/);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// PUT /media — oversized Content-Length (413)
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /media: oversized Content-Length returns 413",
  async fn() {
    const body = new Uint8Array(100);
    const hash = await sha256Hex(body);
    const auth = makeMediaAuth({ hash });

    const res = await app.fetch(
      new Request("http://localhost/media", {
        method: "PUT",
        headers: {
          "Content-Length": "999999999",
          "Content-Type": "image/png",
          "X-SHA-256": hash,
          Authorization: encodeAuth(auth),
        },
        body: body.slice(),
      }),
    );
    assertEquals(res.status, 413);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// PUT /media — disallowed MIME type (415)
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /media: disallowed MIME type returns 415",
  async fn() {
    const body = new Uint8Array(100);
    const hash = await sha256Hex(body);
    const auth = makeMediaAuth({ hash });

    const res = await app.fetch(
      new Request("http://localhost/media", {
        method: "PUT",
        headers: {
          "Content-Length": String(body.byteLength),
          "Content-Type": "application/x-executable",
          "X-SHA-256": hash,
          Authorization: encodeAuth(auth),
        },
        body: body.slice(),
      }),
    );
    assertEquals(res.status, 415);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// HEAD /media — acceptable request (200)
// ---------------------------------------------------------------------------

Deno.test({
  name: "HEAD /media: acceptable request returns 200",
  async fn() {
    const res = await app.fetch(
      new Request("http://localhost/media", { method: "HEAD" }),
    );
    assertEquals(res.status, 200);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// HEAD /media — oversized X-Content-Length (413)
// ---------------------------------------------------------------------------

Deno.test({
  name: "HEAD /media: oversized X-Content-Length returns 413",
  async fn() {
    const res = await app.fetch(
      new Request("http://localhost/media", {
        method: "HEAD",
        headers: { "X-Content-Length": "999999999" },
      }),
    );
    assertEquals(res.status, 413);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// HEAD /media — disallowed X-Content-Type (415)
// ---------------------------------------------------------------------------

Deno.test({
  name: "HEAD /media: disallowed X-Content-Type returns 415",
  async fn() {
    const res = await app.fetch(
      new Request("http://localhost/media", {
        method: "HEAD",
        headers: { "X-Content-Type": "application/x-executable" },
      }),
    );
    assertEquals(res.status, 415);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

Deno.test({
  name: "media e2e teardown: cleanup",
  async fn() {
    await cleanup();
  },
  ...testOpts,
});
