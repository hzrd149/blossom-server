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
  const owner = "a".repeat(64), reporter = "b".repeat(64), hash = "1".repeat(64), missing = "2".repeat(64);
  try {
    for (const pubkey of [owner, reporter]) await insertBlob(db, { sha256: hash, type: "text/plain", size: 10, uploaded: 100, nip94: null }, pubkey);
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
      ConfigSchema.parse({ dashboard: { enabled: true, username: "admin", password: "test" }, landing: { enabled: false } }),
    );
    const request = (path: string, method = "GET", auth = true) =>
      app.fetch(new Request(`http://localhost/admin${path}`, { method, headers: auth ? { Authorization: `Basic ${btoa("admin:test")}` } : {} }));
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
    const second = await (await request("/api/reports?pageSize=1&page=2")).json();
    assertEquals(second.items[0].ownerCount, 2);
    assertEquals(second.items[0].blobSize, 10);
    assertEquals((await (await request("/api/reports?type=spam")).json()).total, 2);
    assertEquals((await (await request("/api/reports?type=unspecified")).json()).total, 1);
    assertEquals((await (await request("/api/reports?q=EVIDENCE%201")).json()).total, 1);
    assertEquals((await (await request("/api/reports?q=%25")).json()).total, 0);
    assertEquals((await (await request(`/api/reports?q=${reporter}`)).json()).total, 2);
    for (const query of ["page=0", "pageSize=101", "sort=nope", "type=nope", "dir=nope"]) {
      const response = await request(`/api/reports?${query}`);
      assertEquals(response.status, 400);
      await response.body?.cancel();
    }
    const dismiss = await request(`/api/reports/${second.items[0].id}/dismiss`, "POST");
    assertEquals(dismiss.status, 200);
    await dismiss.body?.cancel();
    assertEquals((await getBlob(db, hash))?.size, 10);
    const remaining = await (await request("/api/reports?type=spam")).json();
    assertEquals(remaining.total, 1);
    const deletion = await request(`/api/reports/${remaining.items[0].id}/delete-blob`, "POST");
    assertEquals(deletion.status, 200);
    await deletion.body?.cancel();
    assertEquals(await getBlob(db, hash), null);
    assertEquals((await (await request("/api/reports")).json()).total, 1);
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
