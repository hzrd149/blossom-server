import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { getBlob, insertBlob } from "../../src/db/blobs.ts";
import { insertReport } from "../../src/db/reports.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";

Deno.test("admin reports filter, paginate and moderate shared blobs without inflating totals", async () => {
  const dir = await Deno.makeTempDir();
  const db = await initDb({ path: join(dir, "test.db") });
  const storage = new LocalStorage(join(dir, "blobs"));
  await storage.setup();
  const owner = "a".repeat(64),
    reporter = "b".repeat(64),
    hash = "1".repeat(64),
    missing = "2".repeat(64);
  try {
    for (const pubkey of [owner, reporter]) {
      await insertBlob(db, {
        sha256: hash,
        type: "text/plain",
        size: 10,
        uploaded: 100,
        nip94: null,
      }, pubkey);
    }
    for (const [index, blob] of [hash, hash, missing].entries()) {
      await insertReport(db, {
        event_id: String(index + 3).repeat(64),
        reporter: index === 1 ? owner : reporter,
        blob,
        type: index === 2 ? null : "spam",
        content: `Evidence ${index}`,
        created: 200,
      });
    }
    const app = await buildApp(
      db,
      storage,
      ConfigSchema.parse({
        dashboard: { enabled: true, username: "admin", password: "test" },
        landing: { enabled: false },
      }),
    );
    const request = (
      path: string,
      method = "GET",
      auth = true,
      body?: unknown,
      origin = "http://localhost",
    ) =>
      app.fetch(
        new Request(`http://localhost/admin${path}`, {
          method,
          headers: {
            ...(auth ? { Authorization: `Basic ${btoa("admin:test")}` } : {}),
            "Content-Type": "application/json",
            Origin: origin,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    const list = async (query = "") => await (await request(`/api/reports${query ? `?${query}` : ""}`)).json();
    const cleanup = async (target: string) =>
      await (await request("/api/reports/cleanup", "POST", true, { target }))
        .json();
    for (const path of ["/reports", "/api/reports"]) {
      const response = await request(path, "GET", false);
      assertEquals(response.status, 401);
      await response.body?.cancel();
    }
    const page = await request("/reports");
    assertEquals(page.status, 200);
    await page.body?.cancel();
    const all = await (await request("/api/reports?pageSize=1")).json();
    assertEquals([all.total, all.blobCount, all.reporterCount], [3, 2, 2]);
    assertEquals(all.items[0].blobSize, null);
    const second = await (await request("/api/reports?pageSize=1&page=2"))
      .json();
    assertEquals(second.items[0].ownerCount, 2);
    assertEquals(second.items[0].blobSize, 10);
    assertEquals(second.items[0].blobReportCount, 2);
    assertEquals(second.items[0].path, `/${hash}.txt`);
    assertEquals(all.items[0].blobReportCount, 1);
    assertEquals(
      (await (await request("/api/reports?type=spam")).json()).total,
      2,
    );
    assertEquals(
      (await (await request("/api/reports?type=unspecified")).json()).total,
      1,
    );
    assertEquals(
      (await (await request("/api/reports?q=EVIDENCE%201")).json()).total,
      1,
    );
    assertEquals((await (await request("/api/reports?q=%25")).json()).total, 0);
    assertEquals(
      (await (await request(`/api/reports?q=${reporter}`)).json()).total,
      2,
    );
    const filed = await list(`reporter=${reporter}`);
    assertEquals([filed.total, filed.blobCount, filed.reporterCount], [
      2,
      2,
      1,
    ]);
    assertEquals(
      filed.items.every((item: { reporter: string }) => item.reporter === reporter),
      true,
    );
    const received = await list(`owner=${owner}`);
    assertEquals([received.total, received.blobCount, received.reporterCount], [
      2,
      1,
      2,
    ]);
    assertEquals(
      received.items.every((item: { blob: string }) => item.blob === hash),
      true,
    );
    assertEquals(
      (await list(`owner=${owner}&reporter=${reporter}&q=Evidence&type=spam`))
        .total,
      1,
    );
    assertEquals(
      (await list(`owner=${owner}&pageSize=1&page=2`)).items.length,
      1,
    );
    assertEquals((await list(`owner=${"c".repeat(64)}`)).total, 0);
    assertEquals((await list("owner=anonymous")).total, 0);
    assertEquals((await list("reporter=anonymous")).total, 0);
    assertEquals((await list("availability=stored")).total, 2);
    assertEquals((await list("availability=missing")).total, 1);
    assertEquals((await list("status=active")).total, 3);
    assertEquals((await list("status=dismissed")).total, 0);
    for (
      const query of [
        "page=0",
        "pageSize=101",
        "sort=nope",
        "type=nope",
        "dir=nope",
        "status=nope",
        "availability=nope",
        "owner=nope",
        "reporter=nope",
      ]
    ) {
      const response = await request(`/api/reports?${query}`);
      assertEquals(response.status, 400);
      await response.body?.cancel();
    }
    const dismiss = await request(
      `/api/reports/${second.items[0].id}/dismiss`,
      "POST",
    );
    assertEquals(dismiss.status, 200);
    await dismiss.body?.cancel();
    assertEquals((await getBlob(db, hash))?.size, 10);
    const remaining = await (await request("/api/reports?type=spam")).json();
    assertEquals(remaining.total, 2);
    assertEquals(
      (await list("status=active&type=spam&availability=stored")).total,
      1,
    );
    const dismissed = await list("status=dismissed&availability=stored");
    assertEquals(dismissed.total, 1);
    assertEquals(dismissed.items[0].dismissed, true);
    // Re-submitting the same event must not reset dismissal.
    await insertReport(db, {
      event_id: dismissed.items[0].eventId,
      reporter: owner,
      blob: hash,
      type: "spam",
      content: "Evidence 1",
      created: 200,
    });
    assertEquals((await list("status=dismissed")).total, 1);
    const deletion = await request(
      `/api/reports/${remaining.items[0].id}/delete-blob`,
      "POST",
    );
    assertEquals(deletion.status, 200);
    await deletion.body?.cancel();
    assertEquals(await getBlob(db, hash), null);
    assertEquals((await list()).total, 3);
    assertEquals((await list("availability=missing")).total, 3);
    assertEquals(
      (await list("status=dismissed&availability=missing")).total,
      1,
    );
    // Cleanup requires authentication, same-origin requests, and a valid target.
    for (
      const [auth, origin, target, expected] of [
        [false, "http://localhost", "missing", 401],
        [true, "https://other.example", "missing", 403],
        [true, "http://localhost", "all", 400],
      ] as const
    ) {
      const response = await request("/api/reports/cleanup", "POST", auth, {
        target,
      }, origin);
      assertEquals(response.status, expected);
      await response.body?.cancel();
    }
    assertEquals((await list()).total, 3);
    // A re-upload between listing and cleanup protects every report for that hash.
    await insertBlob(db, {
      sha256: hash,
      type: "text/plain",
      size: 10,
      uploaded: 300,
      nip94: null,
    }, owner);
    assertEquals(await cleanup("missing"), { success: true, deleted: 1 });
    assertEquals((await list()).total, 2);
    assertEquals((await list("availability=stored")).total, 2);
    assertEquals(await cleanup("dismissed"), { success: true, deleted: 1 });
    assertEquals((await list("status=dismissed")).total, 0);
    assertEquals((await list("status=active")).total, 1);
    assertEquals((await getBlob(db, hash))?.size, 10);
    assertEquals(await cleanup("dismissed"), { success: true, deleted: 0 });
    assertEquals(await cleanup("missing"), { success: true, deleted: 0 });
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
