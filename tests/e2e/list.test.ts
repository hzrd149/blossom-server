/**
 * E2E tests for GET /list/:pubkey (BUD-02) status codes.
 *
 * Runs against a real Hono app with a real LibSQL DB, real LocalStorage in a
 * temp dir, and a real upload worker pool (1 worker). A test blob is uploaded
 * once during setup and reused across all list tests.
 *
 * sanitizeOps/sanitizeResources are disabled because the worker pool uses
 * MessagePorts that outlive individual tests (by design — they're reused).
 */

import { assertEquals } from "@std/assert";
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
import type { BlossomVariables } from "../../src/middleware/auth.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sk = generateSecretKey();
const pk = getPublicKey(sk);

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await stdCrypto.subtle.digest(
    "SHA-256",
    data.buffer as ArrayBuffer,
  );
  return encodeHex(new Uint8Array(buf));
}

function makeUploadAuth(
  opts: {
    hash?: string;
    expiration?: number;
    tTag?: string;
  } = {},
): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["t", opts.tTag ?? "upload"],
    ["expiration", String(opts.expiration ?? now + 600)],
  ];
  if (opts.hash) tags.push(["x", opts.hash]);
  return finalizeEvent(
    {
      kind: 24242,
      created_at: now,
      tags,
      content: "Upload blob",
    },
    sk,
  );
}

function encodeAuth(event: NostrEvent): string {
  return `Nostr ${
    encodeBase64Url(new TextEncoder().encode(JSON.stringify(event)))
  }`;
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let app: Hono<{ Variables: BlossomVariables }>;
let blobHash: string;
let cleanup: () => Promise<void>;

const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

// ---------------------------------------------------------------------------
// Setup: create app and upload a test blob
// ---------------------------------------------------------------------------

Deno.test({
  name: "list e2e setup: upload test blob",
  async fn() {
    const tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_list_" });
    const dbPath = join(tmpDir, "test.db");
    const storageDir = join(tmpDir, "blobs");
    const dbConfig = { path: dbPath };

    const db = await initDb(dbConfig);
    const storage = new LocalStorage(storageDir);
    await storage.setup();

    const pool = initPool(1, 4, 500, db, dbConfig);

    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: true, enabled: true },
      list: { enabled: true, requireAuth: false, allowListOthers: true },
    });

    app = await buildApp(db, storage, config);

    // Upload a test blob so the pubkey owns at least one blob
    const body = new TextEncoder().encode("list e2e test blob");
    blobHash = await sha256Hex(body);
    const auth = makeUploadAuth({});

    const uploadRes = await app.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: {
          "Content-Length": String(body.byteLength),
          "Content-Type": "text/plain",
          Authorization: encodeAuth(auth),
        },
        body,
      }),
    );
    assertEquals(uploadRes.status, 200, "Setup: upload should succeed");
    await uploadRes.body?.cancel();

    cleanup = async () => {
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    };
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// GET /list/:pubkey — success cases
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET /list/:pubkey: returns 200 with blob descriptors",
  async fn() {
    const res = await app.fetch(new Request(`http://localhost/list/${pk}`));
    assertEquals(res.status, 200);

    const descriptors = await res.json();
    assertEquals(Array.isArray(descriptors), true);
    assertEquals(descriptors.length >= 1, true);

    const first = descriptors[0];
    assertEquals(typeof first.sha256, "string");
    assertEquals(typeof first.url, "string");
    assertEquals(typeof first.size, "number");
    assertEquals(typeof first.type, "string");
  },
  ...testOpts,
});

Deno.test({
  name: "GET /list/:pubkey: returns 200 with empty array for unknown pubkey",
  async fn() {
    const unknownPubkey = "a".repeat(64);
    const res = await app.fetch(
      new Request(`http://localhost/list/${unknownPubkey}`),
    );
    assertEquals(res.status, 200);

    const descriptors = await res.json();
    assertEquals(Array.isArray(descriptors), true);
    assertEquals(descriptors.length, 0);
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// GET /list/:pubkey — 400 cases (invalid query params)
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET /list/:pubkey: invalid limit returns 400",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost/list/${pk}?limit=-1`),
    );
    assertEquals(res.status, 400);

    const reason = res.headers.get("X-Reason") ?? "";
    assertEquals(reason.toLowerCase().includes("limit"), true);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "GET /list/:pubkey: invalid since returns 400",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost/list/${pk}?since=notanumber`),
    );
    assertEquals(res.status, 400);

    const reason = res.headers.get("X-Reason") ?? "";
    assertEquals(reason.toLowerCase().includes("since"), true);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "GET /list/:pubkey: invalid until returns 400",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost/list/${pk}?until=notanumber`),
    );
    assertEquals(res.status, 400);

    const reason = res.headers.get("X-Reason") ?? "";
    assertEquals(reason.toLowerCase().includes("until"), true);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "GET /list/:pubkey: invalid pubkey format returns 400",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost/list/not-a-hex-pubkey`),
    );
    assertEquals(res.status, 400);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

Deno.test({
  name: "list e2e teardown: shutdown shared server",
  async fn() {
    await cleanup();
  },
  ...testOpts,
});
