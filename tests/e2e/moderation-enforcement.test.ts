/**
 * E2E: moderation enforcement on the Blossom routes (docs/moderation/local-bans.md#enforcement).
 *
 * Runs the full Hono app with a real LibSQL DB, local storage, and a real upload worker pool.
 *
 * sanitizeOps/sanitizeResources are disabled because the worker pool's MessagePorts outlive
 * individual tests by design.
 */

import type { Hono } from "@hono/hono";
import { assert, assertEquals } from "@std/assert";
import { encodeBase64Url } from "@std/encoding/base64url";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import type { Client } from "@libsql/client";
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import sharp from "sharp";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { upsertBannedBlobs } from "../../src/db/moderation/bans.ts";
import type { BlossomVariables } from "../../src/middleware/auth.ts";
import { createServerRuntime, type ServerRuntime, stopServerRuntime } from "../../src/runtime.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool, type UploadWorkerPool } from "../../src/workers/pool.ts";

const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

const userSk = generateSecretKey();
const bannedSk = generateSecretKey();
const bannedPk = getPublicKey(bannedSk);

async function sha256Hex(data: Uint8Array): Promise<string> {
  return encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data.slice().buffer)));
}

/** Unique test content and its hash. */
async function blob(label: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string }> {
  const bytes = new TextEncoder().encode(`moderation-enforcement:${label}:${crypto.randomUUID()}`);
  return { bytes, hash: await sha256Hex(bytes) };
}

function auth(sk: Uint8Array, t: string, hashes: string[] = []): string {
  const now = Math.floor(Date.now() / 1000);
  const event: NostrEvent = finalizeEvent({
    kind: 24242,
    created_at: now,
    tags: [["t", t], ["expiration", String(now + 600)], ...hashes.map((h) => ["x", h])],
    content: "moderation test",
  }, sk);
  return `Nostr ${encodeBase64Url(new TextEncoder().encode(JSON.stringify(event)))}`;
}

/** A request body that records whether it was cancelled (proves the body was not consumed). */
function trackedBody(bytes: Uint8Array<ArrayBuffer>): { body: ReadableStream<Uint8Array>; cancelled: () => boolean; pulled: () => boolean } {
  let cancelled = false;
  let pulled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled = true;
      controller.enqueue(bytes);
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  return { body, cancelled: () => cancelled, pulled: () => pulled };
}

let app: Hono<{ Variables: BlossomVariables }>;
let runtime: ServerRuntime;
let db: Client;
let storage: LocalStorage;
let pool: UploadWorkerPool;
let tmpDir: string;

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return await app.fetch(new Request(`http://localhost${path}`, init));
}

async function upload(
  bytes: Uint8Array<ArrayBuffer>,
  opts: { sk?: Uint8Array; declare?: boolean; hash?: string; type?: string } = {},
): Promise<Response> {
  const hash = opts.hash ?? await sha256Hex(bytes);
  const headers: Record<string, string> = {
    "Content-Type": opts.type ?? "text/plain",
    "Content-Length": String(bytes.byteLength),
    Authorization: auth(opts.sk ?? userSk, "upload", [hash]),
  };
  if (opts.declare) headers["X-SHA-256"] = hash;
  return await request("/upload", { method: "PUT", headers, body: bytes });
}

async function isStored(sha256: string): Promise<boolean> {
  const rs = await db.execute({ sql: "SELECT 1 FROM blobs WHERE sha256 = ?", args: [sha256] });
  return rs.rows.length > 0;
}

async function stagedFiles(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(storage.tmpDir)) names.push(entry.name);
  return names;
}

async function expectBlocked(res: Response, reason = "blob is blocked"): Promise<void> {
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("X-Reason"), reason);
  await res.body?.cancel();
}

Deno.test({
  name: "moderation e2e setup",
  async fn() {
    tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_moderation_" });
    const dbPath = join(tmpDir, "test.db");
    db = await initDb({ path: dbPath });
    storage = new LocalStorage(join(tmpDir, "blobs"));
    await storage.setup();
    pool = initPool(1, 4, 500, db, { path: dbPath });
    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      storage: { rules: [{ type: "*", expiration: "1 month" }] },
      upload: { enabled: true, requireAuth: true, requirePubkeyInRule: false },
      mirror: { enabled: true, requireAuth: true },
      media: { enabled: true, requireAuth: true, requirePubkeyInRule: false, tmpDir: join(tmpDir, "media-tmp") },
      delete: { requireAuth: true },
      list: { enabled: true, requireAuth: false, allowListOthers: true },
      report: { enabled: true },
    });
    runtime = await createServerRuntime(db, storage, config);
    app = await buildApp(db, storage, config, { runtime });
    await runtime.moderation.banPubkey({ pubkey: bannedPk });
  },
  ...testOpts,
});

// --- Banned pubkeys ---

Deno.test({
  name: "banned pubkey: PUT /upload is rejected before the body is read",
  async fn() {
    const { bytes, hash } = await blob("banned-upload");
    const tracked = trackedBody(bytes);
    const res = await request("/upload", {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "Content-Length": String(bytes.byteLength), Authorization: auth(bannedSk, "upload", [hash]) },
      body: tracked.body,
    });
    await expectBlocked(res, "pubkey is banned");
    assert(!tracked.pulled(), "body must not be read");
    assert(tracked.cancelled(), "body must be cancelled");
    assertEquals(await isStored(hash), false);
  },
  ...testOpts,
});

Deno.test({
  name: "banned pubkey: HEAD /upload and HEAD /media are rejected",
  async fn() {
    const { hash } = await blob("banned-head");
    const head = await request("/upload", {
      method: "HEAD",
      headers: { Authorization: auth(bannedSk, "upload", [hash]), "X-SHA-256": hash, "X-Content-Length": "10", "X-Content-Type": "text/plain" },
    });
    await expectBlocked(head, "pubkey is banned");
    const media = await request("/media", { method: "HEAD", headers: { Authorization: auth(bannedSk, "media", [hash]) } });
    await expectBlocked(media, "pubkey is banned");
  },
  ...testOpts,
});

Deno.test({
  name: "banned pubkey: PUT /media is rejected before the body is read",
  async fn() {
    const { bytes, hash } = await blob("banned-media");
    const tracked = trackedBody(bytes);
    const res = await request("/media", {
      method: "PUT",
      headers: { "Content-Type": "image/png", "Content-Length": String(bytes.byteLength), Authorization: auth(bannedSk, "media", [hash]) },
      body: tracked.body,
    });
    await expectBlocked(res, "pubkey is banned");
    assert(!tracked.pulled());
    assert(tracked.cancelled());
  },
  ...testOpts,
});

Deno.test({
  name: "banned pubkey: PUT /mirror is rejected before the origin fetch",
  async fn() {
    const { hash } = await blob("banned-mirror");
    let fetches = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      fetches++;
      return Promise.resolve(new Response("x"));
    };
    try {
      const res = await request("/mirror", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: auth(bannedSk, "upload", [hash]) },
        body: JSON.stringify({ url: "https://1.1.1.1/blob" }),
      });
      await expectBlocked(res, "pubkey is banned");
      assertEquals(fetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
  ...testOpts,
});

Deno.test({
  name: "banned pubkey: PUT /report is rejected and not stored (auth header or report signer)",
  async fn() {
    const { hash } = await blob("banned-report");
    const report = finalizeEvent({ kind: 1984, created_at: Math.floor(Date.now() / 1000), tags: [["x", hash, "spam"]], content: "" }, bannedSk);
    const signed = await request("/report", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
    await expectBlocked(signed, "pubkey is banned");

    const byUser = finalizeEvent({ kind: 1984, created_at: Math.floor(Date.now() / 1000), tags: [["x", hash, "spam"]], content: "" }, userSk);
    const viaAuth = await request("/report", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: auth(bannedSk, "upload") },
      body: JSON.stringify(byUser),
    });
    await expectBlocked(viaAuth, "pubkey is banned");
    assertEquals((await db.execute({ sql: "SELECT COUNT(*) FROM reports WHERE blob = ?", args: [hash] })).rows[0][0], 0);

    const ok = await request("/report", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(byUser) });
    assertEquals(ok.status, 200);
    await ok.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "banned pubkey: DELETE of its own blob is still allowed",
  async fn() {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const { bytes, hash } = await blob("banned-delete");
    const res = await upload(bytes, { sk });
    assertEquals(res.status, 201);
    await res.body?.cancel();
    await runtime.moderation.banPubkey({ pubkey: pk });
    const del = await request(`/${hash}`, { method: "DELETE", headers: { Authorization: auth(sk, "delete", [hash]) } });
    assert(del.status >= 200 && del.status < 300, `expected success, got ${del.status}`);
    await del.body?.cancel();
    assertEquals(await isStored(hash), false);
  },
  ...testOpts,
});

// --- Banned hashes ---

Deno.test({
  name: "banned hash: HEAD /upload and HEAD /media preflight return 403",
  async fn() {
    const { hash } = await blob("banned-hash-head");
    await runtime.moderation.banBlob({ sha256: hash, category: "spam" });
    const head = await request("/upload", {
      method: "HEAD",
      headers: { Authorization: auth(userSk, "upload", [hash]), "X-SHA-256": hash, "X-Content-Length": "10", "X-Content-Type": "text/plain" },
    });
    await expectBlocked(head);
    const media = await request("/media", { method: "HEAD", headers: { Authorization: auth(userSk, "media", [hash]), "X-SHA-256": hash } });
    await expectBlocked(media);
  },
  ...testOpts,
});

Deno.test({
  name: "banned hash: PUT /upload with a banned X-SHA-256 is rejected before the body is read",
  async fn() {
    const { bytes, hash } = await blob("banned-hash-header");
    await runtime.moderation.banBlob({ sha256: hash, category: "illegal" });
    const tracked = trackedBody(bytes);
    const res = await request("/upload", {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": String(bytes.byteLength),
        "X-SHA-256": hash,
        Authorization: auth(userSk, "upload", [hash]),
      },
      body: tracked.body,
    });
    await expectBlocked(res);
    assert(!tracked.pulled());
    assert(tracked.cancelled());
  },
  ...testOpts,
});

Deno.test({
  name: "banned hash: PUT /upload without X-SHA-256 is rejected after hashing and the data discarded",
  async fn() {
    const { bytes, hash } = await blob("banned-hash-body");
    await runtime.moderation.banBlob({ sha256: hash, category: "malware" });
    await expectBlocked(await upload(bytes));
    assertEquals(await isStored(hash), false);
    assertEquals(await storage.has(hash, "txt"), false);
    assertEquals(await stagedFiles(), []);
  },
  ...testOpts,
});

Deno.test({
  name: "banned hash: PUT /mirror rejects a banned requested hash before fetching and re-checks the download",
  async fn() {
    const { bytes, hash } = await blob("banned-mirror-hash");
    await runtime.moderation.banBlob({ sha256: hash, category: "spam" });
    let fetches = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      fetches++;
      return Promise.resolve(new Response(bytes.slice(), { headers: { "Content-Type": "text/plain" } }));
    };
    try {
      const preFetch = await request("/mirror", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: auth(userSk, "upload", [hash]) },
        body: JSON.stringify({ url: `https://1.1.1.1/${hash}.txt` }),
      });
      await expectBlocked(preFetch);
      assertEquals(fetches, 0);

      // Hash unknown before the fetch (no hash in the URL, two x tags): checked after download.
      const other = (await blob("other")).hash;
      const postFetch = await request("/mirror", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: auth(userSk, "upload", [hash, other]) },
        body: JSON.stringify({ url: "https://1.1.1.1/download" }),
      });
      await expectBlocked(postFetch);
      assertEquals(fetches, 1);
      assertEquals(await isStored(hash), false);
      assertEquals(await stagedFiles(), []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /mirror of a hash that is not banned succeeds",
  async fn() {
    const { bytes, hash } = await blob("mirror-ok");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(bytes.slice(), { headers: { "Content-Type": "text/plain" } }));
    try {
      const res = await request("/mirror", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: auth(userSk, "upload", [hash]) },
        body: JSON.stringify({ url: `https://1.1.1.1/${hash}` }),
      });
      assertEquals(res.status, 200);
      await res.body?.cancel();
      assert(await isStored(hash));
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
  ...testOpts,
});

Deno.test({
  name: "banned hash: PUT /media rejects a banned input hash",
  async fn() {
    const { bytes, hash } = await blob("banned-media-input");
    await runtime.moderation.banBlob({ sha256: hash, category: "spam" });
    const res = await request("/media", {
      method: "PUT",
      headers: { "Content-Type": "image/png", "Content-Length": String(bytes.byteLength), Authorization: auth(userSk, "media", [hash]) },
      body: bytes,
    });
    await expectBlocked(res);
  },
  ...testOpts,
});

Deno.test({
  name: "PUT /media rejects a banned optimized output",
  async fn() {
    const png = new Uint8Array(
      await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 90 } } }).png().toBuffer(),
    );
    const originalHash = await sha256Hex(png);
    const put = () =>
      request("/media", {
        method: "PUT",
        headers: { "Content-Type": "image/png", "Content-Length": String(png.byteLength), Authorization: auth(userSk, "media", [originalHash]) },
        body: png,
      });
    const res = await put();
    assertEquals(res.status, 201);
    const descriptor = await res.json() as { sha256: string };
    const optimized = descriptor.sha256;
    assert(await isStored(optimized));
    assertEquals(await isStored(originalHash), false, "the media original is not stored");

    // Ban only the optimized output (not its original or thumbnails).
    await db.execute({ sql: "DELETE FROM media_derivatives WHERE optimized_sha256 = ?", args: [optimized] });
    await db.execute({ sql: "DELETE FROM media_thumbnails WHERE parent_sha256 = ?", args: [optimized] });
    await db.execute({ sql: "DELETE FROM owners WHERE blob = ?", args: [optimized] });
    await db.execute({ sql: "DELETE FROM blobs WHERE sha256 = ?", args: [optimized] });
    await upsertBannedBlobs(db, [{ sha256: optimized, category: "spam", note: null }]);
    await expectBlocked(await put());
    assertEquals(await isStored(optimized), false);
  },
  ...testOpts,
});

// --- Banning stored content ---

Deno.test({
  name: "banning a stored blob deletes it for every owner; GET 404, re-upload rejected, unban allows it again",
  async fn() {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const { bytes, hash } = await blob("stored-ban");
    for (const owner of [userSk, sk]) {
      const res = await upload(bytes, { sk: owner });
      assert(res.status === 200 || res.status === 201, `upload status ${res.status}`);
      await res.body?.cancel();
    }
    await runtime.moderation.banBlob({ sha256: hash, category: "spam" });
    assertEquals(await isStored(hash), false);
    assertEquals(await storage.has(hash, "txt"), false);

    const get = await request(`/${hash}.txt`);
    assertEquals(get.status, 404);
    await get.body?.cancel();
    const list = await request(`/list/${pk}`);
    assertEquals(await list.json(), []);

    await expectBlocked(await upload(bytes, { declare: true }));
    await expectBlocked(await upload(bytes));
    assertEquals(await stagedFiles(), []);

    assert(await runtime.moderation.unbanBlob(hash));
    const reupload = await upload(bytes);
    assertEquals(reupload.status, 201);
    await reupload.body?.cancel();
  },
  ...testOpts,
});

Deno.test({
  name: "moderation e2e teardown",
  async fn() {
    await stopServerRuntime(runtime);
    pool.shutdown();
    db.close();
    await Deno.remove(tmpDir, { recursive: true });
  },
  ...testOpts,
});
