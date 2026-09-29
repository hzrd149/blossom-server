/**
 * E2E: GET serving policy for active content.
 *
 * Direct navigation to an uploaded HTML/SVG/XML blob must never execute
 * script on the app origin. The blob route forces Content-Disposition:
 * attachment + X-Content-Type-Options: nosniff for active MIME types; this
 * exercises that over the real route (upload → GET, header assertions).
 *
 * Runs in its OWN file: it builds a private app + worker pool, and
 * initPool() replaces the global singleton — sharing upload.test.ts's pool
 * here would corrupt those tests.
 */

import { assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { encodeBase64Url } from "@std/encoding/base64url";
import { join } from "@std/path";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";

const sk = generateSecretKey();

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return encodeHex(new Uint8Array(buf));
}

function encodeAuth(event: unknown): string {
  return `Nostr ${encodeBase64Url(new TextEncoder().encode(JSON.stringify(event)))}`;
}

Deno.test({
  name: "GET serving policy: HTML/SVG/XHTML/XML/XSLT are attachment+nosniff; PNG stays inline",
  async fn() {
    const serveDir = await Deno.makeTempDir({
      prefix: "blossom_e2e_serving_",
    });
    const dbConfig = { path: join(serveDir, "serving.db") };
    const db = await initDb(dbConfig);
    const storage = new LocalStorage(join(serveDir, "blobs"));
    await storage.setup();
    const pool = initPool(1, 4, 500, db, dbConfig);
    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { requireAuth: true, enabled: true },
    });
    const app = await buildApp(db, storage, config);

    async function seed(content: string, type: string): Promise<string> {
      const body = new TextEncoder().encode(content);
      const hash = await sha256Hex(body);
      const now = Math.floor(Date.now() / 1000);
      const ev = finalizeEvent(
        {
          kind: 24242,
          created_at: now,
          tags: [
            ["t", "upload"],
            ["expiration", String(now + 600)],
            ["x", hash],
          ],
          content: "serving test",
        },
        sk,
      );
      const res = await app.fetch(
        new Request("http://localhost/upload", {
          method: "PUT",
          headers: {
            "Content-Length": String(body.byteLength),
            "Content-Type": type,
            Authorization: encodeAuth(ev),
          },
          body,
        }),
      );
      assertEquals(res.status, 201, `seed ${type} should upload`);
      await res.body?.cancel();
      return hash;
    }

    const script = "<script>alert(1)</script>";
    const xslTarget = `<?xml-stylesheet href="https://evil.example/x.xsl"?><a/>`;
    const cases: Array<[string, string]> = [
      [script, "text/html"],
      [script, "image/svg+xml"],
      [script, "application/xhtml+xml"],
      [xslTarget, "text/xml"],
      [xslTarget, "application/xml"],
      [script, "application/xslt+xml"],
    ];
    for (const [content, type] of cases) {
      const hash = await seed(content, type);
      const res = await app.fetch(new Request(`http://localhost/${hash}`));
      assertEquals(res.status, 200, `${type} should serve`);
      const cd = res.headers.get("Content-Disposition") ?? "";
      if (!cd.startsWith("attachment;")) {
        throw new Error(
          `${type} served without attachment disposition (got: "${cd}")`,
        );
      }
      assertEquals(
        res.headers.get("X-Content-Type-Options"),
        "nosniff",
        `${type} must carry nosniff`,
      );
      await res.body?.cancel();
    }

    // Non-active types must remain inline — clients embed them by URL
    const pngHash = await seed("not-a-real-png", "image/png");
    const png = await app.fetch(new Request(`http://localhost/${pngHash}`));
    assertEquals(png.status, 200);
    assertEquals(png.headers.get("Content-Disposition"), null);
    assertEquals(png.headers.get("X-Content-Type-Options"), "nosniff");
    await png.body?.cancel();

    pool.shutdown();
    await db.close();
    await Deno.remove(serveDir, { recursive: true });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
