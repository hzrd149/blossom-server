/**
 * E2E: a closed server (upload.requirePubkeyInRule) whose only rule carries a
 * NIP-05 domain allowlist and no static pubkeys. After one refresh against a
 * stubbed nostr.json, a domain member may upload and mirror while a stranger
 * is rejected on PUT /upload, HEAD /upload, PUT /mirror (before any origin
 * fetch), HEAD /media and PUT /media.
 *
 * A member's successful PUT /media is not exercised here: that path optimises
 * the image with sharp, which (as in media.test.ts) needs the native binary.
 * The gate itself is shared with /upload (getFileRule), so the member HEAD
 * /media preflight and the stranger rejections cover the allowlist behaviour.
 */

import type { Hono } from "@hono/hono";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeBase64Url } from "@std/encoding/base64url";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import type { BlossomVariables } from "../../src/middleware/auth.ts";
import { createServerRuntime, stopServerRuntime } from "../../src/runtime.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";

const memberSk = generateSecretKey();
const memberPk = getPublicKey(memberSk);
const strangerSk = generateSecretKey();

const NOT_AUTHORIZED = "Pubkey not authorized by any storage rule";

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await stdCrypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return encodeHex(new Uint8Array(buf));
}

/** BUD-11 kind 24242 auth, optionally scoped to a blob hash. */
function authHeader(sk: Uint8Array, hash?: string, verb = "upload"): string {
  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [["t", verb], ["expiration", String(now + 600)]];
  if (hash) tags.push(["x", hash]);
  const ev: NostrEvent = finalizeEvent({ kind: 24242, created_at: now, tags, content: "nip05 test" }, sk);
  return `Nostr ${encodeBase64Url(new TextEncoder().encode(JSON.stringify(ev)))}`;
}

const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

Deno.test({
  name: "nip05 allowlist: domain member may upload and mirror, stranger is rejected on upload, preflight, mirror and media",
  async fn() {
    const tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_nip05_" });
    const dbPath = join(tmpDir, "test.db");
    const db = await initDb({ path: dbPath });
    const storage = new LocalStorage(join(tmpDir, "blobs"));
    await storage.setup();
    const pool = initPool(1, 4, 500, db, { path: dbPath });

    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: true, enabled: true, requirePubkeyInRule: true },
      mirror: { enabled: true, requireAuth: true },
      media: { enabled: true, requireAuth: true, requirePubkeyInRule: true },
      storage: {
        backend: "local",
        rules: [{ type: "*", expiration: "1 year", nip05Domains: ["example.org"] }],
      },
    });

    // Stub nostr.json for example.org — no network involved.
    const nostrJsonHits: string[] = [];
    const fetchImpl = ((input: string | URL | Request) => {
      nostrJsonHits.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ names: { alice: memberPk } })));
    }) as typeof fetch;
    const runtime = await createServerRuntime(db, storage, config, { nip05Fetch: fetchImpl });
    const { domains } = await runtime.nip05.refresh();
    assertEquals(domains, [{ domain: "example.org", count: 1, changed: true }]);
    assertEquals(nostrJsonHits, ["https://example.org/.well-known/nostr.json"]);
    assertEquals(runtime.rules.current()[0].pubkeys, [memberPk]);
    assertEquals(config.storage.rules[0].pubkeys, undefined, "config is never modified");

    const app: Hono<{ Variables: BlossomVariables }> = await buildApp(db, storage, config, { runtime });
    const request = (path: string, init: RequestInit) => app.fetch(new Request(`http://localhost${path}`, init));

    // Local origin that records every hit — must stay at zero for the stranger.
    let originHits = 0;
    const origin = Deno.serve({ port: 0 }, () => {
      originHits++;
      return new Response("origin-bytes", { headers: { "content-type": "image/png" } });
    });
    const originUrl = `http://127.0.0.1:${origin.addr.port}/x.png`;
    const originalFetch = globalThis.fetch;

    try {
      const body = new TextEncoder().encode("hello from a nip05 member");
      const hash = await sha256Hex(body);
      const uploadHeaders = (sk: Uint8Array) => ({
        "Content-Length": String(body.byteLength),
        "Content-Type": "text/plain",
        "X-SHA-256": hash,
        Authorization: authHeader(sk, hash),
      });

      // HEAD /upload — member 200, stranger 401
      const memberHead = await request("/upload", {
        method: "HEAD",
        headers: { "X-Content-Length": String(body.byteLength), "X-Content-Type": "text/plain", "X-SHA-256": hash, Authorization: authHeader(memberSk, hash) },
      });
      assertEquals(memberHead.status, 200);

      const strangerHead = await request("/upload", {
        method: "HEAD",
        headers: {
          "X-Content-Length": String(body.byteLength),
          "X-Content-Type": "text/plain",
          "X-SHA-256": hash,
          Authorization: authHeader(strangerSk, hash),
        },
      });
      assertEquals(strangerHead.status, 401);
      assertEquals(strangerHead.headers.get("X-Reason"), NOT_AUTHORIZED);

      // PUT /upload — stranger 401 (body cancelled), member 201
      const strangerPut = await request("/upload", { method: "PUT", headers: uploadHeaders(strangerSk), body: body.slice() });
      assertEquals(strangerPut.status, 401);
      assertEquals(strangerPut.headers.get("X-Reason"), NOT_AUTHORIZED);
      await strangerPut.body?.cancel();

      const memberPut = await request("/upload", { method: "PUT", headers: uploadHeaders(memberSk), body: body.slice() });
      assertEquals(memberPut.status, 201);
      const descriptor = await memberPut.json();
      assertEquals(descriptor.sha256, hash);

      // PUT /mirror — stranger rejected before the origin is contacted
      const strangerMirror = await request("/mirror", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: authHeader(strangerSk) },
        body: JSON.stringify({ url: originUrl }),
      });
      assertEquals(strangerMirror.status, 401);
      assertEquals(strangerMirror.headers.get("X-Reason"), NOT_AUTHORIZED);
      await strangerMirror.body?.cancel();
      assertEquals(originHits, 0, "origin must NOT be fetched for a stranger");

      // PUT /mirror — member succeeds. The SSRF guard rejects loopback origins,
      // so (like mirror-precheck.test.ts) the origin fetch is stubbed on
      // globalThis.fetch for a public literal IP; the allowlist uses its own
      // injected fetchImpl and is unaffected.
      const mirrored = new TextEncoder().encode("mirrored by a nip05 member");
      const mirroredHash = await sha256Hex(mirrored);
      globalThis.fetch = (() => Promise.resolve(new Response(mirrored.slice(), { headers: { "Content-Type": "text/plain" } }))) as typeof fetch;
      const memberMirror = await request("/mirror", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: authHeader(memberSk, mirroredHash) },
        body: JSON.stringify({ url: "https://1.1.1.1/blob" }),
      });
      globalThis.fetch = originalFetch;
      assertEquals(memberMirror.status, 200);
      assertEquals((await memberMirror.json()).sha256, mirroredHash);

      // HEAD /media — member 200, stranger 401 (media.requirePubkeyInRule)
      const mediaHeaders = (sk: Uint8Array) => ({
        "X-Content-Length": "3",
        "X-Content-Type": "image/png",
        Authorization: authHeader(sk, undefined, "media"),
      });
      const memberMediaHead = await request("/media", { method: "HEAD", headers: mediaHeaders(memberSk) });
      assertEquals(memberMediaHead.status, 200);

      const strangerMediaHead = await request("/media", { method: "HEAD", headers: mediaHeaders(strangerSk) });
      assertEquals(strangerMediaHead.status, 401);
      assertEquals(strangerMediaHead.headers.get("X-Reason"), NOT_AUTHORIZED);

      // PUT /media — stranger 401 before any processing
      const png = new Uint8Array([1, 2, 3]);
      const strangerMediaPut = await request("/media", {
        method: "PUT",
        headers: { "Content-Length": String(png.byteLength), "Content-Type": "image/png", Authorization: authHeader(strangerSk, undefined, "media") },
        body: png,
      });
      assertEquals(strangerMediaPut.status, 401);
      assertEquals(strangerMediaPut.headers.get("X-Reason"), NOT_AUTHORIZED);
      await strangerMediaPut.body?.cancel();
    } finally {
      globalThis.fetch = originalFetch;
      await origin.shutdown();
      await stopServerRuntime(runtime);
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
  ...testOpts,
});

Deno.test({
  name: "nip05 allowlist: a member removed from nostr.json loses access after the next refresh",
  async fn() {
    const tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_nip05_revoke_" });
    const dbPath = join(tmpDir, "test.db");
    const db = await initDb({ path: dbPath });
    const storage = new LocalStorage(join(tmpDir, "blobs"));
    await storage.setup();
    const pool = initPool(1, 4, 500, db, { path: dbPath });

    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: true, enabled: true, requirePubkeyInRule: true },
      storage: { rules: [{ type: "*", expiration: "1 year", nip05Domains: ["example.org"] }] },
    });
    let names: Record<string, string> = { alice: memberPk };
    const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ names })))) as typeof fetch;
    const runtime = await createServerRuntime(db, storage, config, { nip05Fetch: fetchImpl });
    const allowlist = runtime.nip05;
    await allowlist.refresh();
    const app = await buildApp(db, storage, config, { runtime });

    const preflight = () =>
      app.fetch(
        new Request("http://localhost/upload", {
          method: "HEAD",
          headers: { "X-Content-Length": "10", "X-Content-Type": "text/plain", Authorization: authHeader(memberSk) },
        }),
      );

    const body = new TextEncoder().encode("upload after revocation");
    const hash = await sha256Hex(body);
    const upload = () =>
      app.fetch(
        new Request("http://localhost/upload", {
          method: "PUT",
          headers: {
            "Content-Length": String(body.byteLength),
            "Content-Type": "text/plain",
            "X-SHA-256": hash,
            Authorization: authHeader(memberSk, hash),
          },
          body: body.slice(),
        }),
      );

    try {
      assertEquals((await preflight()).status, 200);

      names = {};
      await allowlist.refresh();
      const revoked = await preflight();
      assertEquals(revoked.status, 401);
      assertEquals(revoked.headers.get("X-Reason"), NOT_AUTHORIZED);

      const revokedUpload = await upload();
      assertEquals(revokedUpload.status, 401);
      assertEquals(revokedUpload.headers.get("X-Reason"), NOT_AUTHORIZED);
      await revokedUpload.body?.cancel();

      // Re-adding the name restores access on the next refresh.
      names = { alice: memberPk };
      await allowlist.refresh();
      const restored = await upload();
      assertEquals(restored.status, 201);
      assertEquals((await restored.json()).sha256, hash);
    } finally {
      await stopServerRuntime(runtime);
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
  ...testOpts,
});

Deno.test({
  name: "nip05 allowlist: a domain added through the admin console is fetched immediately and admits its members",
  async fn() {
    const tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_nip05_admin_" });
    const dbPath = join(tmpDir, "test.db");
    const db = await initDb({ path: dbPath });
    const storage = new LocalStorage(join(tmpDir, "blobs"));
    await storage.setup();
    const pool = initPool(1, 4, 500, db, { path: dbPath });

    const password = "nip05-admin-password";
    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      dashboard: { enabled: true, password },
      upload: { requireAuth: true, enabled: true, requirePubkeyInRule: true },
      storage: { rules: [{ type: "*", expiration: "1 year" }] },
    });
    // Rules live in config.yml; the console writes the file and applies it.
    const configPath = join(tmpDir, "config.yml");
    await Deno.writeTextFile(configPath, 'storage:\n  rules:\n    - type: "*"\n      expiration: 1 year\n');
    const nostrJsonHits: string[] = [];
    const fetchImpl = ((input: string | URL | Request) => {
      nostrJsonHits.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ names: { alice: memberPk } })));
    }) as typeof fetch;
    const runtime = await createServerRuntime(db, storage, config, { nip05Fetch: fetchImpl });
    await runtime.nip05.refresh();
    assertEquals(nostrJsonHits, [], "no rule has domains yet");
    const app = await buildApp(db, storage, config, { runtime, configPath });

    const preflight = (sk: Uint8Array) =>
      app.fetch(
        new Request("http://localhost/upload", {
          method: "HEAD",
          headers: { "X-Content-Length": "10", "X-Content-Type": "text/plain", Authorization: authHeader(sk) },
        }),
      );
    const api = (path: string, method = "GET", body?: unknown) =>
      app.fetch(
        new Request(`http://localhost/admin/api/${path}`, {
          method,
          headers: { Authorization: `Basic ${btoa(`admin:${password}`)}`, Origin: "http://localhost", "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );

    try {
      assertEquals((await preflight(memberSk)).status, 401);

      const view = await (await api("rules")).json();
      const rules = [{ type: "*", expiration: "1 year", nip05Domains: ["Example.org"] }];
      // Preview against unsaved rules: no members fetched yet, so the member is still rejected.
      const before = await (await api("rules/preview", "POST", { rules, probes: [{ mimeType: "text/plain", pubkey: memberPk }] })).json();
      assertEquals(before.probes[0].status, 401);

      const saved = await api("rules", "PUT", { hash: view.configFile.hash, rules });
      assertEquals(saved.status, 200);
      const savedView = await saved.json();
      assertEquals(savedView.rules, [{ type: "*", expiration: "1 year", nip05Domains: ["example.org"] }]);
      assertStringIncludes(await Deno.readTextFile(configPath), "example.org");

      // The rule-change listener fetches the new domain in the background.
      for (let i = 0; i < 50 && runtime.rules.current()[0].pubkeys?.length !== 1; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assertEquals(nostrJsonHits, ["https://example.org/.well-known/nostr.json"]);
      assertEquals((await preflight(memberSk)).status, 200);
      assertEquals((await preflight(strangerSk)).status, 401);

      const after = await (await api("rules/preview", "POST", { probes: [{ mimeType: "text/plain", pubkey: memberPk }] })).json();
      assertEquals(after.probes[0].status, 200);
      // Fetched members are not exposed as edited rule pubkeys.
      assertEquals((await (await api("rules")).json()).rules[0].pubkeys, undefined);
    } finally {
      await stopServerRuntime(runtime);
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
  ...testOpts,
});
