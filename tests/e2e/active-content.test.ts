import { assertEquals } from "@std/assert";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { insertBlobRecord } from "../../src/db/blobs.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { mimeToExt } from "../../src/utils/mime.ts";

interface Fixture {
  bytes: Uint8Array;
  hash: string;
  type: string;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await stdCrypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return encodeHex(new Uint8Array(digest));
}

Deno.test("blob responses isolate active content without changing ordinary retrieval", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_active_content_" });
  const db = await initDb({ path: join(tmpDir, "test.db") });
  const storage = new LocalStorage(join(tmpDir, "blobs"));
  await storage.setup();

  try {
    const fixtures: Fixture[] = await Promise.all(
      [
        { bytes: new TextEncoder().encode("<h1>active</h1>"), type: "text/html" },
        { bytes: new Uint8Array([137, 80, 78, 71, 13, 10]), type: "image/png" },
        { bytes: new TextEncoder().encode("<problem>active</problem>"), type: "application/problem+xml" },
        {
          bytes: new TextEncoder().encode(
            "--frame\r\nContent-Type: text/html\r\n\r\n<h1>multipart active</h1>\r\n--frame--\r\n",
          ),
          type: "multipart/x-mixed-replace; boundary=frame",
        },
      ].map(async ({ bytes, type }) => ({ bytes, type, hash: await sha256Hex(bytes) })),
    );

    for (const fixture of fixtures) {
      const session = await storage.beginWrite(fixture.bytes.byteLength);
      const writer = session.writable.getWriter();
      await writer.write(fixture.bytes);
      await writer.close();
      await storage.commitWrite(session, fixture.hash, mimeToExt(fixture.type));
      await insertBlobRecord(db, {
        sha256: fixture.hash,
        size: fixture.bytes.byteLength,
        type: fixture.type,
        uploaded: 1_700_000_000,
        nip94: null,
      });
    }

    const [active, ordinary, unmappedActive, multipartActive] = fixtures;
    const config = ConfigSchema.parse({
      publicDomain: "localhost",
      upload: { enabled: false, requireAuth: false },
    });
    const app = await buildApp(db, storage, config);
    const activePath = `/${active.hash}.png`;
    const ordinaryPath = `/${ordinary.hash}.html`;
    const activeDisposition = `attachment; filename="${active.hash}.html"`;
    const multipartPath = `/${multipartActive.hash}.html`;
    const multipartDisposition = `attachment; filename="${multipartActive.hash}"`;

    const activeGet = await app.fetch(new Request(`http://localhost${activePath}`));
    assertEquals(activeGet.status, 200);
    assertEquals(activeGet.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(activeGet.headers.get("Content-Disposition"), activeDisposition);
    assertEquals(activeGet.headers.get("Content-Type"), active.type);
    assertEquals(new Uint8Array(await activeGet.arrayBuffer()), active.bytes);

    const activeHead = await app.fetch(new Request(`http://localhost${activePath}`, { method: "HEAD" }));
    assertEquals(activeHead.status, 200);
    assertEquals(activeHead.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(activeHead.headers.get("Content-Disposition"), activeDisposition);
    assertEquals(await activeHead.text(), "");

    const activeRange = await app.fetch(
      new Request(`http://localhost${activePath}`, { headers: { Range: "bytes=0-3" } }),
    );
    assertEquals(activeRange.status, 206);
    assertEquals(activeRange.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(activeRange.headers.get("Content-Disposition"), activeDisposition);
    assertEquals(activeRange.headers.get("Content-Range"), `bytes 0-3/${active.bytes.byteLength}`);
    assertEquals(new Uint8Array(await activeRange.arrayBuffer()), active.bytes.subarray(0, 4));

    const activeNotModified = await app.fetch(
      new Request(`http://localhost${activePath}`, { headers: { "If-None-Match": `"${active.hash}"` } }),
    );
    assertEquals(activeNotModified.status, 304);
    assertEquals(activeNotModified.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(activeNotModified.headers.get("Content-Disposition"), activeDisposition);
    assertEquals(activeNotModified.headers.get("ETag"), `"${active.hash}"`);
    assertEquals(activeNotModified.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assertEquals(activeNotModified.headers.get("Last-Modified") !== null, true);
    assertEquals(activeNotModified.headers.has("Content-Length"), false);
    assertEquals(await activeNotModified.text(), "");

    const ordinaryGet = await app.fetch(new Request(`http://localhost${ordinaryPath}`));
    assertEquals(ordinaryGet.status, 200);
    assertEquals(ordinaryGet.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(ordinaryGet.headers.has("Content-Disposition"), false);
    assertEquals(ordinaryGet.headers.get("Content-Type"), ordinary.type);
    assertEquals(ordinaryGet.headers.get("ETag"), `"${ordinary.hash}"`);
    assertEquals(new Uint8Array(await ordinaryGet.arrayBuffer()), ordinary.bytes);

    const ordinaryHead = await app.fetch(new Request(`http://localhost${ordinaryPath}`, { method: "HEAD" }));
    assertEquals(ordinaryHead.status, 200);
    assertEquals(ordinaryHead.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(ordinaryHead.headers.has("Content-Disposition"), false);
    assertEquals(await ordinaryHead.text(), "");

    const ordinaryRange = await app.fetch(
      new Request(`http://localhost${ordinaryPath}`, { headers: { Range: "bytes=1-3" } }),
    );
    assertEquals(ordinaryRange.status, 206);
    assertEquals(ordinaryRange.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(ordinaryRange.headers.has("Content-Disposition"), false);
    assertEquals(ordinaryRange.headers.get("Content-Range"), `bytes 1-3/${ordinary.bytes.byteLength}`);
    assertEquals(new Uint8Array(await ordinaryRange.arrayBuffer()), ordinary.bytes.subarray(1, 4));

    const ordinaryNotModified = await app.fetch(
      new Request(`http://localhost${ordinaryPath}`, { headers: { "If-None-Match": `"${ordinary.hash}"` } }),
    );
    assertEquals(ordinaryNotModified.status, 304);
    assertEquals(ordinaryNotModified.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(ordinaryNotModified.headers.has("Content-Disposition"), false);
    assertEquals(ordinaryNotModified.headers.get("ETag"), `"${ordinary.hash}"`);
    assertEquals(ordinaryNotModified.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assertEquals(ordinaryNotModified.headers.get("Last-Modified") !== null, true);
    assertEquals(ordinaryNotModified.headers.has("Content-Length"), false);
    assertEquals(await ordinaryNotModified.text(), "");

    const ordinaryWeakNotModified = await app.fetch(
      new Request(`http://localhost${ordinaryPath}`, { headers: { "If-None-Match": `W/"${ordinary.hash}"` } }),
    );
    assertEquals(ordinaryWeakNotModified.status, 304);
    assertEquals(ordinaryWeakNotModified.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(ordinaryWeakNotModified.headers.has("Content-Disposition"), false);
    assertEquals(ordinaryWeakNotModified.headers.get("ETag"), `"${ordinary.hash}"`);
    assertEquals(ordinaryWeakNotModified.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assertEquals(ordinaryWeakNotModified.headers.get("Last-Modified") !== null, true);
    assertEquals(ordinaryWeakNotModified.headers.has("Content-Length"), false);
    assertEquals(await ordinaryWeakNotModified.text(), "");

    const ordinaryWildcardNotModified = await app.fetch(
      new Request(`http://localhost${ordinaryPath}`, { headers: { "If-None-Match": "  *  " } }),
    );
    assertEquals(ordinaryWildcardNotModified.status, 304);
    assertEquals(ordinaryWildcardNotModified.headers.get("ETag"), `"${ordinary.hash}"`);
    assertEquals(ordinaryWildcardNotModified.headers.has("Content-Length"), false);
    assertEquals(await ordinaryWildcardNotModified.text(), "");

    const ordinaryNonMatching = await app.fetch(
      new Request(`http://localhost${ordinaryPath}`, { headers: { "If-None-Match": `"${active.hash}"` } }),
    );
    assertEquals(ordinaryNonMatching.status, 200);
    assertEquals(new Uint8Array(await ordinaryNonMatching.arrayBuffer()), ordinary.bytes);

    const ordinaryInvalidWeakPrefix = await app.fetch(
      new Request(`http://localhost${ordinaryPath}`, { headers: { "If-None-Match": `w/"${ordinary.hash}"` } }),
    );
    assertEquals(ordinaryInvalidWeakPrefix.status, 200);
    assertEquals(new Uint8Array(await ordinaryInvalidWeakPrefix.arrayBuffer()), ordinary.bytes);

    const ordinaryMixedWildcard = await app.fetch(
      new Request(`http://localhost${ordinaryPath}`, {
        headers: { "If-None-Match": `"${ordinary.hash}", *` },
      }),
    );
    assertEquals(ordinaryMixedWildcard.status, 200);
    assertEquals(new Uint8Array(await ordinaryMixedWildcard.arrayBuffer()), ordinary.bytes);

    const unmappedGet = await app.fetch(new Request(`http://localhost/${unmappedActive.hash}.svg`));
    assertEquals(unmappedGet.status, 200);
    assertEquals(unmappedGet.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(
      unmappedGet.headers.get("Content-Disposition"),
      `attachment; filename="${unmappedActive.hash}"`,
    );
    assertEquals(new Uint8Array(await unmappedGet.arrayBuffer()), unmappedActive.bytes);

    const multipartGet = await app.fetch(new Request(`http://localhost${multipartPath}`));
    assertEquals(multipartGet.status, 200);
    assertEquals(multipartGet.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(multipartGet.headers.get("Content-Disposition"), multipartDisposition);
    assertEquals(multipartGet.headers.get("Content-Type"), multipartActive.type);
    assertEquals(new Uint8Array(await multipartGet.arrayBuffer()), multipartActive.bytes);

    const multipartHead = await app.fetch(new Request(`http://localhost${multipartPath}`, { method: "HEAD" }));
    assertEquals(multipartHead.status, 200);
    assertEquals(multipartHead.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(multipartHead.headers.get("Content-Disposition"), multipartDisposition);
    assertEquals(await multipartHead.text(), "");

    const multipartRange = await app.fetch(
      new Request(`http://localhost${multipartPath}`, { headers: { Range: "bytes=0-6" } }),
    );
    assertEquals(multipartRange.status, 206);
    assertEquals(multipartRange.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(multipartRange.headers.get("Content-Disposition"), multipartDisposition);
    assertEquals(multipartRange.headers.get("Content-Range"), `bytes 0-6/${multipartActive.bytes.byteLength}`);
    assertEquals(new Uint8Array(await multipartRange.arrayBuffer()), multipartActive.bytes.subarray(0, 7));

    const multipartNotModified = await app.fetch(
      new Request(`http://localhost${multipartPath}`, {
        headers: { "If-None-Match": `"${multipartActive.hash}"` },
      }),
    );
    assertEquals(multipartNotModified.status, 304);
    assertEquals(multipartNotModified.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(multipartNotModified.headers.get("Content-Disposition"), multipartDisposition);
    assertEquals(multipartNotModified.headers.get("ETag"), `"${multipartActive.hash}"`);
    assertEquals(multipartNotModified.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assertEquals(multipartNotModified.headers.get("Last-Modified") !== null, true);
    assertEquals(multipartNotModified.headers.has("Content-Length"), false);
    assertEquals(await multipartNotModified.text(), "");

    const multipartWeakNotModified = await app.fetch(
      new Request(`http://localhost${multipartPath}`, {
        headers: { "If-None-Match": `W/"${multipartActive.hash}"` },
      }),
    );
    assertEquals(multipartWeakNotModified.status, 304);
    assertEquals(multipartWeakNotModified.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(multipartWeakNotModified.headers.get("Content-Disposition"), multipartDisposition);
    assertEquals(multipartWeakNotModified.headers.get("ETag"), `"${multipartActive.hash}"`);
    assertEquals(multipartWeakNotModified.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assertEquals(multipartWeakNotModified.headers.get("Last-Modified") !== null, true);
    assertEquals(multipartWeakNotModified.headers.has("Content-Length"), false);
    assertEquals(await multipartWeakNotModified.text(), "");

    const multipartWeakHeadNotModified = await app.fetch(
      new Request(`http://localhost${multipartPath}`, {
        method: "HEAD",
        headers: { "If-None-Match": `W/"${multipartActive.hash}"` },
      }),
    );
    assertEquals(multipartWeakHeadNotModified.status, 304);
    assertEquals(multipartWeakHeadNotModified.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(multipartWeakHeadNotModified.headers.get("Content-Disposition"), multipartDisposition);
    assertEquals(multipartWeakHeadNotModified.headers.get("ETag"), `"${multipartActive.hash}"`);
    assertEquals(multipartWeakHeadNotModified.headers.has("Content-Length"), false);
    assertEquals(await multipartWeakHeadNotModified.text(), "");

    const multipartListNotModified = await app.fetch(
      new Request(`http://localhost${multipartPath}`, {
        headers: { "If-None-Match": `"${ordinary.hash}", W/"${multipartActive.hash}"` },
      }),
    );
    assertEquals(multipartListNotModified.status, 304);
    assertEquals(multipartListNotModified.headers.get("Content-Disposition"), multipartDisposition);
    assertEquals(multipartListNotModified.headers.has("Content-Length"), false);
    assertEquals(await multipartListNotModified.text(), "");
  } finally {
    db.close();
    await Deno.remove(tmpDir, { recursive: true });
  }
});
