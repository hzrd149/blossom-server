/**
 * E2E tests for the /list/:pubkey MIME-type prefix filter (?type=).
 *
 * Seeds a mixed-type library for one key (images, video, audio, text) plus a
 * second key's blobs, then verifies: prefix matching (image → image/*),
 * exact matching (image/png), cursor pagination composed with the filter,
 * charset validation, and that another key's blobs never leak in.
 *
 * sanitizeOps/sanitizeResources disabled: shared worker pool outlives tests.
 */

import type { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { encodeBase64Url } from "@std/encoding/base64url";
import { join } from "@std/path";
import type { NostrEvent } from "nostr-tools";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import type { BlossomVariables } from "../../src/middleware/auth.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";

const skA = generateSecretKey();
const pkA = getPublicKey(skA);
const skB = generateSecretKey();
const pkB = getPublicKey(skB);

function authHeader(sk: Uint8Array, tTag: string): string {
  const now = Math.floor(Date.now() / 1000);
  const ev = finalizeEvent(
    {
      kind: 24242,
      created_at: now,
      tags: [["t", tTag], ["expiration", String(now + 600)]],
      content: "type-filter test",
    },
    sk,
  );
  return `Nostr ${
    encodeBase64Url(new TextEncoder().encode(JSON.stringify(ev)))
  }`;
}

let app: Hono<{ Variables: BlossomVariables }>;
let cleanup: () => Promise<void>;
const imageHashes: string[] = [];
const otherHashes: string[] = [];

const testOpts = { sanitizeOps: false, sanitizeResources: false } as const;

Deno.test({
  name: "type-filter setup: seed mixed library",
  async fn() {
    const tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_type_" });
    const dbPath = join(tmpDir, "test.db");
    const db = await initDb({ path: dbPath });
    const storage = new LocalStorage(join(tmpDir, "blobs"));
    await storage.setup();
    const pool = initPool(1, 4, 500, db, { path: dbPath });

    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: true, enabled: true },
      list: { enabled: true, requireAuth: false },
    });
    app = await buildApp(db, storage, config);

    async function upload(
      sk: Uint8Array,
      content: string,
      contentType: string,
      into?: string[],
    ): Promise<string> {
      const body = new TextEncoder().encode(content);
      const res = await app.fetch(
        new Request("http://localhost/upload", {
          method: "PUT",
          headers: {
            "Content-Length": String(body.byteLength),
            "Content-Type": contentType,
            Authorization: authHeader(sk, "upload"),
          },
          body,
        }),
      );
      assertEquals(res.status, 201, `seed ${content} (${contentType})`);
      const d = await res.json();
      into?.push(d.sha256);
      return d.sha256;
    }

    // A's library: 3 png, 1 webm, 1 mp3, 2 text — plus B-only blobs
    for (let i = 0; i < 3; i++) {
      await upload(skA, `png ${i}`, "image/png", imageHashes);
    }
    await upload(skA, "clip", "video/webm", otherHashes);
    await upload(skA, "tone", "audio/mpeg", otherHashes);
    for (let i = 0; i < 2; i++) {
      await upload(skA, `text ${i}`, "text/plain", otherHashes);
    }
    await upload(skB, "b png", "image/png");
    await upload(skB, "b text", "text/plain");

    cleanup = async () => {
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    };
  },
  ...testOpts,
});

Deno.test({
  name: "type-filter: ?type=image returns only image/* for the key",
  async fn() {
    const res = await app.fetch(
      new Request(`http://localhost/list/${pkA}?type=image&limit=100`),
    );
    assertEquals(res.status, 200);
    const descriptors = await res.json();
    assertEquals(descriptors.length, 3);
    assertEquals(
      descriptors.every((d: { type: string }) => d.type.startsWith("image/")),
      true,
    );
    for (const h of imageHashes) {
      assertEquals(
        descriptors.some((d: { sha256: string }) => d.sha256 === h),
        true,
      );
    }
  },
  ...testOpts,
});

Deno.test({
  name: "type-filter: exact subtype and prefix semantics",
  async fn() {
    const exact = await app.fetch(
      new Request(`http://localhost/list/${pkA}?type=image/png&limit=100`),
    );
    assertEquals((await exact.json()).length, 3);

    const video = await app.fetch(
      new Request(`http://localhost/list/${pkA}?type=video&limit=100`),
    );
    assertEquals((await video.json()).length, 1);

    // Prefix semantics on the full MIME string: "video/we" matches the
    // seeded "video/webm"; a non-matching prefix ("video/mp") returns empty.
    const prefix = await app.fetch(
      new Request(`http://localhost/list/${pkA}?type=video/we&limit=100`),
    );
    assertEquals((await prefix.json()).length, 1);
    const noMatch = await app.fetch(
      new Request(`http://localhost/list/${pkA}?type=video/mp&limit=100`),
    );
    assertEquals((await noMatch.json()).length, 0);
  },
  ...testOpts,
});

Deno.test({
  name: "type-filter: composes with cursor pagination",
  async fn() {
    // limit=2 over 3 images -> page sizes 2 then 1, all hashes exactly once
    const collected: string[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL(`http://localhost/list/${pkA}`);
      url.searchParams.set("type", "image");
      url.searchParams.set("limit", "2");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await app.fetch(new Request(url));
      assertEquals(res.status, 200);
      const page = await res.json();
      for (const d of page) collected.push(d.sha256);
      cursor = page.length ? page[page.length - 1].sha256 : undefined;
    } while (cursor);
    assertEquals(collected.length, 3);
    assertEquals(new Set(collected).size, 3);
  },
  ...testOpts,
});

Deno.test({
  name: "type-filter: invalid charset rejected with 400",
  async fn() {
    for (const bad of ["image%22", "foo%20bar", "-nope"]) {
      const res = await app.fetch(
        new Request(`http://localhost/list/${pkA}?type=${bad}`),
      );
      assertEquals(res.status, 400, `type=${bad} must 400`);
      await res.body?.cancel();
    }
  },
  ...testOpts,
});

Deno.test({
  name: "type-filter: teardown",
  async fn() {
    await cleanup();
  },
  ...testOpts,
});
