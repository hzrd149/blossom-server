import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { insertBlob } from "../../src/db/blobs.ts";
import { insertReport } from "../../src/db/reports.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";

Deno.test("admin users combine owners and reporters with accurate shared storage and paginated activity", async () => {
  const dir = await Deno.makeTempDir();
  const db = await initDb({ path: join(dir, "test.db") });
  const storage = new LocalStorage(join(dir, "blobs"));
  await storage.setup();
  const a = "a".repeat(64), b = "b".repeat(64), reporter = "c".repeat(64);
  const hash = "1".repeat(64), other = "2".repeat(64);
  try {
    await insertBlob(db, { sha256: hash, type: "image/png", size: 10, uploaded: 100, nip94: null }, a);
    await insertBlob(db, { sha256: hash, type: "image/png", size: 10, uploaded: 100, nip94: null }, b);
    await insertBlob(db, { sha256: other, type: "text/plain", size: 20, uploaded: 200, nip94: null }, a);
    await insertBlob(db, { sha256: "3".repeat(64), type: null, size: 5, uploaded: 300, nip94: null }, "anonymous");
    await db.execute({ sql: "UPDATE owners SET uploaded = 250 WHERE pubkey = ?", args: [b] });
    await db.execute({ sql: "UPDATE owners SET uploaded = CASE WHEN blob = ? THEN 100 ELSE 200 END WHERE pubkey = ?", args: [hash, a] });
    for (const [index, author] of [reporter, a].entries()) {
      await insertReport(db, { event_id: String(index + 4).repeat(64), reporter: author, blob: hash, type: "spam", content: "Report", created: 400 + index });
    }
    const app = await buildApp(
      db,
      storage,
      ConfigSchema.parse({ dashboard: { enabled: true, username: "admin", password: "test" }, landing: { enabled: false } }),
    );
    const request = (path: string, auth = true) =>
      app.fetch(new Request(`http://localhost/admin${path}`, { headers: auth ? { Authorization: `Basic ${btoa("admin:test")}` } : {} }));
    for (const path of ["/users", `/users/${a}`, "/api/users", `/api/users/${a}`, `/api/users/${a}/blobs`, `/api/users/${a}/reports`]) {
      const response = await request(path, false);
      assertEquals(response.status, 401);
      await response.body?.cancel();
    }
    for (const path of ["/users", `/users/${a}`]) {
      const response = await request(path);
      assertEquals(response.status, 200);
      await response.body?.cancel();
    }
    const all = await (await request("/api/users?sort=totalSize&dir=desc&pageSize=2")).json();
    assertEquals(all.total, 4);
    assertEquals(all.items.map((u: { pubkey: string }) => u.pubkey), [a, b]);
    assertEquals(all.items[0].totalSize, 30, "Reports must not multiply stored bytes");
    assertEquals(all.items[0].blobCount, 2);
    assertEquals(all.items[0].sharedBlobCount, 1);
    assertEquals(all.items[0].receivedReportCount, 2);
    assertEquals(all.items[0].reportCount, 1);
    assertEquals((await (await request("/api/users?page=2&pageSize=2")).json()).items.length, 2);
    assertEquals((await (await request("/api/users?role=reporters")).json()).total, 2);
    assertEquals((await (await request("/api/users?role=owners")).json()).total, 3);
    assertEquals((await (await request(`/api/users?q=${reporter}`)).json()).total, 1);
    assertEquals((await (await request("/api/users?q=%25")).json()).total, 0, "Search is literal, not a LIKE wildcard");
    const profile = await (await request(`/api/users/${b}`)).json();
    assertEquals(profile.firstUpload, 250);
    assertEquals(profile.lastUpload, 250);
    const reportOnly = await (await request(`/api/users/${reporter}`)).json();
    assertEquals(reportOnly.blobCount, 0);
    assertEquals(reportOnly.firstUpload, null);
    assertEquals(reportOnly.firstReport, 400);
    const blobs = await (await request(`/api/users/${a}/blobs?pageSize=1&page=2`)).json();
    assertEquals(blobs.total, 2);
    assertEquals(blobs.items[0].sha256, hash);
    assertEquals(blobs.items[0].ownerCount, 2);
    const received = await (await request(`/api/users/${b}/reports?scope=received&pageSize=1`)).json();
    assertEquals(received.total, 2);
    assertEquals(received.items.length, 1);
    assertEquals(received.items[0].reporter, a);
    assertEquals((await (await request(`/api/users/${reporter}/reports`)).json()).total, 1);
    assertEquals((await (await request("/api/summary")).json()).userCount, 4);
    for (const path of ["/api/users?sort=malicious", "/api/users?pageSize=101", "/api/users?page=0", "/api/users/nope", `/api/users/${a}/reports?scope=nope`]) {
      const response = await request(path);
      assertEquals(response.status, 400, path);
      await response.body?.cancel();
    }
    const missing = await request(`/api/users/${"f".repeat(64)}`);
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
