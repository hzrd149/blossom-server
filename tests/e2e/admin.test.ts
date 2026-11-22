import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { countOwners, getBlob, insertBlob } from "../../src/db/blobs.ts";
import { insertReport, listAllReports } from "../../src/db/reports.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";

const password = "test-password-must-not-appear-in-responses";
const authorization = `Basic ${btoa(`admin:${password}`)}`;
const owner = "a".repeat(64);
const otherOwner = "b".repeat(64);

Deno.test("admin namespace isolates auth, API contracts, the React shell, and disabled assets", async () => {
  const dir = await Deno.makeTempDir({ prefix: "blossom-admin-" });
  const db = await initDb({ path: join(dir, "test.db") });
  const storage = new LocalStorage(join(dir, "blobs"));
  await storage.setup();
  try {
    const config = ConfigSchema.parse({ dashboard: { enabled: true, username: "admin", password }, landing: { enabled: false } });
    let staticCalls = 0;
    const app = await buildApp(db, storage, config, {
      staticMiddleware: async (_c, next) => {
        staticCalls++;
        await next();
      },
    });
    const request = (path: string, authenticated = true, options: RequestInit = {}) =>
      app.fetch(
        new Request(`http://localhost${path}`, {
          ...options,
          headers: { ...(authenticated ? { Authorization: authorization } : {}), ...options.headers },
        }),
      );

    for (const path of ["/admin", "/admin/console", "/admin/api/summary", "/admin/assets/client.js", "/admin/client.js"]) {
      const response = await request(path, false);
      assertEquals(response.status, 401, path);
      assert(response.headers.has("www-authenticate"));
      await response.body?.cancel();
    }
    const wrongPassword = await request("/admin/api/summary", false, { headers: { Authorization: `Basic ${btoa("admin:wrong")}` } });
    assertEquals(wrongPassword.status, 401);
    await wrongPassword.body?.cancel();

    for (const path of ["/admin", "/admin/content", "/admin/rules", "/admin/settings", `/admin/blobs/${owner}`, "/admin/content/"]) {
      const response = await request(path);
      assertEquals(response.status, 200, path);
      assertStringIncludes(response.headers.get("content-type") ?? "", "text/html");
      assertEquals(response.headers.get("access-control-allow-origin"), null);
      assertEquals(response.headers.get("cache-control"), "no-store");
      const html = await response.text();
      assertStringIncludes(html, "admin-root");
      assert(!html.includes("/admin/blobs"));
    }
    const redirect = await request("/admin/console");
    assertEquals(redirect.status, 302);
    assertEquals(redirect.headers.get("location"), "/admin");
    await redirect.body?.cancel();
    for (
      const path of ["/admin/blobs", "/admin/blobs/a/b", "/admin/nope", "/admin/rulesx", "/admin/assets", "/admin/%ZZ"]
    ) {
      const response = await request(path);
      assertEquals(response.status, 404, path);
      await response.body?.cancel();
    }
    for (const path of ["/admin/api/missing", "/admin/api"]) {
      const response = await request(path);
      assertEquals(response.status, 404);
      assertEquals(await response.json(), { error: "Not found" });
    }
    const configResponse = await request("/admin/api/configuration");
    const summary = await configResponse.json();
    assertEquals(summary.managementMode, "deployment-managed");
    assertEquals(summary.editable, false);
    assertEquals(summary.configFile, { path: null, exists: false, writable: false });
    assertEquals(Object.keys(summary.settings).sort(), ["storageBackend", "storageRuleCount", "uploadEnabled", "uploadMaxSize", "uploadRequireAuth"]);
    assert(!JSON.stringify(summary).includes(password));

    for (let i = 0; i < 3; i++) {
      await insertBlob(db, { sha256: String(i).repeat(64), type: "image/png", size: 10, uploaded: i, nip94: null }, owner);
    }
    const listing = await request("/admin/api/content?pageSize=2&page=2&q=image");
    const page = await listing.json();
    assertEquals(page.total, 3);
    assertEquals(page.items.length, 1);
    assertEquals(page.items[0].sha256, "0".repeat(64));
    assertEquals(Object.keys(page.items[0]).sort(), ["owners", "path", "sha256", "size", "type", "uploaded"]);
    assertEquals(page.items[0].path, `/${"0".repeat(64)}.png`);
    const owned = await (await request(`/admin/api/content?owner=${owner}`)).json();
    assertEquals(owned.total, 3);
    const notOwned = await (await request(`/admin/api/content?owner=${otherOwner}`)).json();
    assertEquals(notOwned.total, 0);
    const detail = await (await request(`/admin/api/blobs/${"1".repeat(64)}`)).json();
    assertEquals(detail.owners.map((o: { pubkey: string }) => o.pubkey), [owner]);
    assertEquals(detail.retention.ruleIndex, 0);
    assertEquals(detail.retention.rule.type, "image/*");
    const missingBlob = await request(`/admin/api/blobs/${"f".repeat(64)}`);
    assertEquals(missingBlob.status, 404);
    await missingBlob.body?.cancel();
    for (const query of ["page=NaN", "page=-1", "pageSize=101", "page=1.5", "page=1000001", "sort=owners", "owner=npub1x"]) {
      const response = await request(`/admin/api/content?${query}`);
      assertEquals(response.status, 400, query);
      await response.body?.cancel();
    }
    assertEquals(staticCalls, 0, "Admin paths must not reach public static middleware");
    const preflight = await request("/upload", false, {
      method: "OPTIONS",
      headers: { Origin: "https://client.example", "Access-Control-Request-Method": "PUT" },
    });
    assertEquals(preflight.status, 204);
    assertEquals(preflight.headers.get("access-control-allow-origin"), "*");
    await preflight.body?.cancel();

    const disabled = await buildApp(db, storage, { ...config, dashboard: { ...config.dashboard, enabled: false } });
    for (const path of ["/admin", "/admin/console", "/admin/assets/client.js", "/admin/client.js", "/%61dmin/client.js", "/admin/api/summary"]) {
      const response = await disabled.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: authorization } }));
      assertEquals(response.status, 404, path);
      await response.body?.cancel();
    }
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("admin actions retain force-delete and moderation behavior through management services", async () => {
  const dir = await Deno.makeTempDir({ prefix: "blossom-admin-actions-" });
  const db = await initDb({ path: join(dir, "test.db") });
  const storage = new LocalStorage(join(dir, "blobs"));
  await storage.setup();
  try {
    const config = ConfigSchema.parse({ dashboard: { enabled: true, username: "admin", password } });
    const app = await buildApp(db, storage, config);
    const request = (path: string, method: string, origin = "http://localhost") =>
      app.fetch(
        new Request(`http://localhost/admin/api/${path}`, {
          method,
          headers: { Authorization: authorization, Origin: origin },
        }),
      );
    const hash = "c".repeat(64);
    const blob = { sha256: hash, type: "text/plain", size: 4, uploaded: 1, nip94: null };
    await insertBlob(db, blob, owner);
    await insertBlob(db, blob, otherOwner);
    const source = join(dir, "source.txt");
    await Deno.writeTextFile(source, "test");
    await storage.commitFile(source, hash, "txt");
    const rejected = await request(`blobs/${hash}`, "DELETE", "https://other.example");
    assertEquals(rejected.status, 403);
    await rejected.body?.cancel();
    assert(await getBlob(db, hash));
    assert(await storage.has(hash, "txt"));
    const removed = await request(`users/${owner}`, "DELETE");
    assertEquals(await removed.json(), { success: true, deleted: 1 });
    assertEquals(await getBlob(db, hash), null);
    assertEquals(await countOwners(db, hash), 0);
    assertEquals(await storage.has(hash, "txt"), false);

    await insertBlob(db, blob, owner);
    const report = { event_id: "d".repeat(64), reporter: otherOwner, blob: hash, type: "spam" as const, content: "spam", created: 1 };
    await insertReport(db, report);
    let reports = await listAllReports(db);
    const dismissed = await request(`reports/${reports[0].id}/dismiss`, "POST");
    assertEquals(await dismissed.json(), { success: true });
    assert(await getBlob(db, hash), "Dismissing reports must retain content");
    assertEquals((await listAllReports(db)).length, 0);
    await insertReport(db, report);
    reports = await listAllReports(db);
    const deleted = await request(`reports/${reports[0].id}/delete-blob`, "POST");
    assertEquals(await deleted.json(), { success: true });
    assertEquals(await getBlob(db, hash), null);
    assertEquals((await listAllReports(db)).length, 0);
    const missing = await request("reports/999/dismiss", "POST");
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
