/**
 * E2E tests for GET /:sha256[.ext] (BUD-01) — range request support.
 *
 * Runs against a real Hono app with a real LibSQL DB, real LocalStorage in a
 * temp dir, and a real upload worker pool (1 worker). The same blob is uploaded
 * once during setup and reused across all range tests.
 *
 * sanitizeOps/sanitizeResources are disabled because the worker pool uses
 * MessagePorts that outlive individual tests (by design — they're reused).
 */

import { assertEquals } from "@std/assert";
import { encodeBase64Url } from "@std/encoding/base64url";
import { encodeHex } from "@std/encoding/hex";
import { crypto as stdCrypto } from "@std/crypto";
import { join } from "@std/path";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { serveStatic } from "@hono/hono/deno";
import type { NostrEvent } from "nostr-tools";
import { initDb } from "../../src/db/client.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";
import { buildApp } from "../../src/server.ts";
import { ConfigSchema } from "../../src/config/schema.ts";
import type { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { BlossomVariables } from "../../src/middleware/auth.ts";
import type { Config } from "../../src/config/schema.ts";
import { PUBLIC_DIR } from "../../src/routes/landing.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sk = generateSecretKey();

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await stdCrypto.subtle.digest(
    "SHA-256",
    data.buffer as ArrayBuffer,
  );
  return encodeHex(new Uint8Array(buf));
}

function makeUploadAuth(hash?: string): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["t", "upload"],
    ["expiration", String(now + 600)],
  ];
  if (hash) tags.push(["x", hash]);
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
  return `Nostr ${encodeBase64Url(new TextEncoder().encode(JSON.stringify(event)))}`;
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

// 20 bytes with known content — easy to verify sub-ranges manually
const BLOB_DATA = new Uint8Array([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
]);
const BLOB_SIZE = BLOB_DATA.byteLength; // 20

let app: Hono<{ Variables: BlossomVariables }>;
let db: Client;
let storage: LocalStorage;
let config: Config;
let blobHash: string;
let blobUrl: string;
let cleanup: () => Promise<void>;

const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

// ---------------------------------------------------------------------------
// Setup: upload the test blob once
// ---------------------------------------------------------------------------

Deno.test({
  name: "blobs e2e setup: upload test blob",
  async fn() {
    const tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_blobs_" });
    const dbPath = join(tmpDir, "test.db");
    const storageDir = join(tmpDir, "blobs");

    db = await initDb({ path: dbPath });
    storage = new LocalStorage(storageDir);
    await storage.setup();

    const pool = initPool(1, 4, 500, db, { path: dbPath });

    config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: false, enabled: true },
    });

    app = await buildApp(db, storage, config);

    // Upload the test blob
    blobHash = await sha256Hex(BLOB_DATA);
    const auth = makeUploadAuth(blobHash);

    const uploadRes = await app.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: {
          "Content-Length": String(BLOB_SIZE),
          "Content-Type": "application/octet-stream",
          "X-SHA-256": blobHash,
          Authorization: encodeAuth(auth),
        },
        body: BLOB_DATA,
      }),
    );
    assertEquals(uploadRes.status, 201, "Upload should succeed");
    const descriptor = await uploadRes.json();
    blobUrl = new URL(descriptor.url).pathname; // e.g. /abc123...

    cleanup = async () => {
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    };
  },
  ...testOpts,
});

Deno.test({
  name: "static candidacy seam bypasses malformed paths and observes a safe control",
  async fn() {
    let staticInvocations = 0;
    const staticMiddleware: MiddlewareHandler = async (_ctx, next) => {
      staticInvocations++;
      await next();
    };
    const observedApp = await buildApp(db, storage, config, { staticMiddleware });

    const malformed = await observedApp.fetch(new Request("http://localhost/bad%252fpath"));
    assertEquals(malformed.status, 404);
    assertEquals(staticInvocations, 0, "malformed path must bypass static middleware");
    await malformed.body?.cancel();

    const safe = await observedApp.fetch(new Request("http://localhost/nested/asset.css"));
    assertEquals(safe.status, 404);
    assertEquals(staticInvocations, 1, "safe control must prove the injected middleware is live");
    await safe.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "static candidacy invokes middleware only for safe nested, space, Unicode, and boundary paths",
  async fn() {
    let staticInvocations = 0;
    const staticMiddleware: MiddlewareHandler = async (_ctx, next) => {
      staticInvocations++;
      await next();
    };
    const observedApp = await buildApp(db, storage, config, { staticMiddleware });
    const exactMaxPath = `/${Array.from({ length: 8 }, () => "a".repeat(255)).join("/")}`;
    const overMaxPath = `/${
      [
        ...Array.from({ length: 8 }, () => "a".repeat(226)),
        "b".repeat(232),
      ].join("/")
    }`;

    const safePaths = [
      "/nested/assets/app.js",
      "/operator%20assets/logo.png",
      "/caf%C3%A9/%F0%9F%8C%B8.png",
      `/${"😀".repeat(63)}`,
      exactMaxPath,
    ];
    for (const pathname of safePaths) {
      const before = staticInvocations;
      const response = await observedApp.fetch(new Request(`http://localhost${pathname}`));
      assertEquals(response.status, 404);
      assertEquals(staticInvocations, before + 1, `${pathname} should invoke static middleware`);
      await response.body?.cancel();
    }

    const unsafePaths = [
      "/bad%encoding.js",
      "/bad%2fpath",
      "/bad%252Fpath",
      "/bad%5cpath",
      "/bad%00path",
      "/nested//asset.js",
      `/${"a".repeat(256)}`,
      overMaxPath,
    ];
    for (const pathname of unsafePaths) {
      const before = staticInvocations;
      const response = await observedApp.fetch(new Request(`http://localhost${pathname}`));
      assertEquals(response.status, 404);
      assertEquals(staticInvocations, before, `${pathname} must bypass static middleware`);
      await response.body?.cancel();
    }
  },
  ...testOpts,
});

Deno.test({
  name: "real static adapter bypasses a 256-byte multibyte segment without filesystem warnings",
  async fn() {
    const notFoundPaths: string[] = [];
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    let safeStatus = 0;
    let overflowStatus = 0;

    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const staticMiddleware = serveStatic({
        root: PUBLIC_DIR,
        onNotFound: (path) => {
          notFoundPaths.push(path);
        },
      });
      const observedApp = await buildApp(db, storage, config, { staticMiddleware });

      const safe = await observedApp.fetch(new Request(`http://localhost/${"😀".repeat(63)}`));
      safeStatus = safe.status;
      await safe.body?.cancel();

      const overflow = await observedApp.fetch(new Request(`http://localhost/${"😀".repeat(64)}`));
      overflowStatus = overflow.status;
      await overflow.body?.cancel();
    } finally {
      console.warn = originalWarn;
    }

    assertEquals(safeStatus, 404);
    assertEquals(overflowStatus, 404);
    assertEquals(notFoundPaths.length, 1, "only the 252-byte control should reach the real static adapter");
    assertEquals(warnings, [], "rejected overflow must not provoke a filesystem warning");
  },
  ...testOpts,
});

Deno.test({
  name: "GET and HEAD blob: accepted hash variants and cosmetic suffixes use stored metadata",
  async fn() {
    const acceptedPaths = [
      `/${blobHash.toUpperCase()}`,
      `/${blobHash}.a`,
      `/${blobHash}.abcdefghij`,
      `/${blobHash}.tar.gz.123/`,
      `/${blobHash}.html/`,
    ];

    for (const pathname of acceptedPaths) {
      const getResponse = await app.fetch(new Request(`http://localhost${pathname}`));
      assertEquals(getResponse.status, 200, pathname);
      assertEquals(getResponse.headers.get("Content-Type"), "application/octet-stream", pathname);
      assertEquals(new Uint8Array(await getResponse.arrayBuffer()), BLOB_DATA, pathname);

      const headResponse = await app.fetch(new Request(`http://localhost${pathname}`, { method: "HEAD" }));
      assertEquals(headResponse.status, 200, pathname);
      assertEquals(headResponse.headers.get("Content-Type"), "application/octet-stream", pathname);
    }
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: malformed hash and suffix matrix falls through to normal 404",
  async fn() {
    const malformedPaths = [
      `/${blobHash.slice(1)}`,
      `/${blobHash}a`,
      `/${blobHash}.abcdefghijk`,
      `/${blobHash}.`,
      `/${blobHash}.png//extra`,
      `/${blobHash}//`,
      `/${blobHash}%22`,
      `/${blobHash},png`,
      `/${blobHash}%7B%22ext%22%3A%22png%22%7D`,
      `/${blobHash}%20.png`,
      `/${blobHash}%2fextra`,
      `/${blobHash}%252Fextra`,
      `/${blobHash}%5cextra`,
    ];

    for (const pathname of malformedPaths) {
      const response = await app.fetch(new Request(`http://localhost${pathname}`));
      assertEquals(response.status, 404, pathname);
      await response.body?.cancel();
    }
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// GET — full download (no Range header)
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET blob: no Range header returns 200 with full content",
  async fn() {
    const res = await app.fetch(new Request(`http://localhost${blobUrl}`));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Accept-Ranges"), "bytes");
    assertEquals(res.headers.get("Content-Length"), String(BLOB_SIZE));

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, BLOB_DATA);
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// HEAD — should return 200, accept-ranges, ignore Range header
// ---------------------------------------------------------------------------

Deno.test({
  name: "HEAD blob: returns 200 with Accept-Ranges regardless of Range header",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        method: "HEAD",
        headers: { Range: "bytes=0-9" },
      }),
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Accept-Ranges"), "bytes");
    assertEquals(res.headers.get("Content-Length"), String(BLOB_SIZE));
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Range — 206 cases
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET blob: Range bytes=0-3 returns 206 with first 4 bytes",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=0-3" },
      }),
    );
    assertEquals(res.status, 206);
    assertEquals(res.headers.get("Content-Range"), `bytes 0-3/${BLOB_SIZE}`);
    assertEquals(res.headers.get("Content-Length"), "4");

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, BLOB_DATA.subarray(0, 4));
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: Range bytes=16-19 returns 206 with last 4 bytes",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=16-19" },
      }),
    );
    assertEquals(res.status, 206);
    assertEquals(res.headers.get("Content-Range"), `bytes 16-19/${BLOB_SIZE}`);
    assertEquals(res.headers.get("Content-Length"), "4");

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, BLOB_DATA.subarray(16, 20));
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: Range bytes=0-0 returns 206 with single byte",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=0-0" },
      }),
    );
    assertEquals(res.status, 206);
    assertEquals(res.headers.get("Content-Range"), `bytes 0-0/${BLOB_SIZE}`);
    assertEquals(res.headers.get("Content-Length"), "1");

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, new Uint8Array([0]));
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: suffix range bytes=-5 returns 206 with last 5 bytes",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=-5" },
      }),
    );
    assertEquals(res.status, 206);
    assertEquals(res.headers.get("Content-Range"), `bytes 15-19/${BLOB_SIZE}`);
    assertEquals(res.headers.get("Content-Length"), "5");

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, BLOB_DATA.subarray(15, 20));
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: open-end range bytes=10- returns 206 from byte 10 to end",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=10-" },
      }),
    );
    assertEquals(res.status, 206);
    assertEquals(res.headers.get("Content-Range"), `bytes 10-19/${BLOB_SIZE}`);
    assertEquals(res.headers.get("Content-Length"), "10");

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, BLOB_DATA.subarray(10, 20));
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: mid-file range bytes=5-14 returns 206 with correct slice",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=5-14" },
      }),
    );
    assertEquals(res.status, 206);
    assertEquals(res.headers.get("Content-Range"), `bytes 5-14/${BLOB_SIZE}`);
    assertEquals(res.headers.get("Content-Length"), "10");

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, BLOB_DATA.subarray(5, 15));
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: range ending past EOF is clamped to the last byte",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: `bytes=0-${BLOB_SIZE}` },
      }),
    );
    assertEquals(res.status, 206);
    assertEquals(
      res.headers.get("Content-Range"),
      `bytes 0-${BLOB_SIZE - 1}/${BLOB_SIZE}`,
    );
    assertEquals(res.headers.get("Content-Length"), String(BLOB_SIZE));

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, BLOB_DATA);
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: aligned slice past EOF returns the remainder, not 416",
  async fn() {
    // The shape nginx's slice module produces for a final slice: the start is
    // inside the blob, the end runs past it.
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: `bytes=16-${BLOB_SIZE + 500}` },
      }),
    );
    assertEquals(res.status, 206);
    assertEquals(
      res.headers.get("Content-Range"),
      `bytes 16-${BLOB_SIZE - 1}/${BLOB_SIZE}`,
    );
    assertEquals(res.headers.get("Content-Length"), String(BLOB_SIZE - 16));

    const body = new Uint8Array(await res.arrayBuffer());
    assertEquals(body, BLOB_DATA.subarray(16));
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Range — 416 cases
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET blob: start > end returns 416",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=10-5" },
      }),
    );
    assertEquals(res.status, 416);
    assertEquals(res.headers.get("Content-Range"), `bytes */${BLOB_SIZE}`);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: start >= size returns 416",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: `bytes=${BLOB_SIZE}-${BLOB_SIZE + 10}` },
      }),
    );
    assertEquals(res.status, 416);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: malformed Range header returns 416",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=foobar" },
      }),
    );
    assertEquals(res.status, 416);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "GET blob: multi-range returns 416 (not supported)",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost${blobUrl}`, {
        headers: { Range: "bytes=0-4, 10-14" },
      }),
    );
    assertEquals(res.status, 416);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// 404 — non-existent blobs
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET blob: non-existent hash returns 404",
  async fn() {
    const fakeHash = "f".repeat(64);
    const res = await app.fetch(new Request(`http://localhost/${fakeHash}`));
    assertEquals(res.status, 404);
    await res.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "HEAD blob: non-existent hash returns 404",
  async fn() {
    const fakeHash = "f".repeat(64);
    const res = await app.fetch(
      new Request(`http://localhost/${fakeHash}`, { method: "HEAD" }),
    );
    assertEquals(res.status, 404);
    await res.body?.cancel();
  },
  ...testOpts,
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

Deno.test({
  name: "blobs e2e teardown: shutdown shared server",
  async fn() {
    await cleanup();
  },
  ...testOpts,
});
