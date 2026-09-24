/**
 * E2E: PUT /mirror rejects non-allowlisted uploaders BEFORE the origin fetch
 * when upload.requirePubkeyInRule is set. Proves ordering (not just the 401)
 * by running a local origin listener and asserting it received ZERO requests.
 */

import type { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { encodeBase64Url } from "@std/encoding/base64url";
import { join } from "@std/path";
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import type { BlossomVariables } from "../../src/middleware/auth.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";

const allowedSk = generateSecretKey();
const allowedPk = getPublicKey(allowedSk);
const strangerSk = generateSecretKey();

function authHeader(sk: Uint8Array): string {
  const now = Math.floor(Date.now() / 1000);
  const ev: NostrEvent = finalizeEvent(
    {
      kind: 24242,
      created_at: now,
      tags: [["t", "upload"], ["expiration", String(now + 600)]],
      content: "mirror test",
    },
    sk,
  );
  return `Nostr ${encodeBase64Url(new TextEncoder().encode(JSON.stringify(ev)))}`;
}

const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

Deno.test({
  name: "mirror precheck: stranger rejected pre-fetch, origin never hit",
  async fn() {
    const tmpDir = await Deno.makeTempDir({
      prefix: "blossom_e2e_mirrorgate_",
    });
    const dbPath = join(tmpDir, "test.db");
    const db = await initDb({ path: dbPath });
    const storage = new LocalStorage(join(tmpDir, "blobs"));
    await storage.setup();
    const pool = initPool(1, 4, 500, db, { path: dbPath });

    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: true, enabled: true, requirePubkeyInRule: true },
      mirror: { enabled: true, requireAuth: true },
      storage: {
        backend: "local",
        rules: [
          {
            type: "*",
            expiration: "1 year",
            pubkeys: [allowedPk],
          },
        ],
      },
    });
    const app: Hono<{ Variables: BlossomVariables }> = await buildApp(
      db,
      storage,
      config,
    );

    // local origin that records every hit
    let originHits = 0;
    const origin = Deno.serve({ port: 0 }, () => {
      originHits++;
      return new Response("origin-bytes", {
        headers: { "content-type": "image/png" },
      });
    });
    const originUrl = `http://127.0.0.1:${origin.addr.port}/x.png`;

    try {
      // stranger (valid signature, NOT in any rule) → 401, zero origin hits.
      // The X-Reason proves the ALLOWLIST check fired (not the SSRF guard,
      // which would reject the loopback origin with a different message) —
      // i.e. unauthorized users never even reach URL validation.
      const res = await app.fetch(
        new Request("http://localhost/mirror", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader(strangerSk),
          },
          body: JSON.stringify({ url: originUrl }),
        }),
      );
      assertEquals(res.status, 401);
      assertEquals(
        (res.headers.get("X-Reason") ?? "").includes("not authorized"),
        true,
      );
      await res.body?.cancel();
      assertEquals(originHits, 0, "origin must NOT be fetched for a stranger");
    } finally {
      await origin.shutdown();
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
  ...testOpts,
});
