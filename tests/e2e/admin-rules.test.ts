import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { insertBlob } from "../../src/db/blobs.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";

const password = "rules-test-password";
const authorization = `Basic ${btoa(`admin:${password}`)}`;
const DAY = 86400;

async function setup(rulesManagement: "config" | "database") {
  const dir = await Deno.makeTempDir({ prefix: "blossom-admin-rules-" });
  const db = await initDb({ path: join(dir, "test.db") });
  const storage = new LocalStorage(join(dir, "blobs"));
  await storage.setup();
  const config = ConfigSchema.parse({
    dashboard: { enabled: true, password },
    upload: { requireAuth: false },
    storage: { rulesManagement, rules: [{ type: "*", expiration: "1 year" }] },
  });
  const app = await buildApp(db, storage, config);
  const api = (path: string, method = "GET", body?: unknown, origin = "http://localhost") =>
    app.fetch(
      new Request(`http://localhost/admin/api/${path}`, {
        method,
        headers: { Authorization: authorization, Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const preflight = (type: string) =>
    app.fetch(new Request("http://localhost/upload", { method: "HEAD", headers: { "X-Content-Type": type, "X-Content-Length": "10" } }));
  const cleanup = async () => {
    db.close();
    await Deno.remove(dir, { recursive: true });
  };
  return { db, api, preflight, cleanup };
}

Deno.test("database-managed rules are edited through the API and hot-applied to uploads", async () => {
  const { db, api, preflight, cleanup } = await setup("database");
  try {
    const view = await (await api("rules")).json();
    assertEquals(view.mode, "database");
    assertEquals(view.editable, true);
    assertEquals(view.rules, [{ type: "*", expiration: "1 year", enabled: true }]);

    const rules = [{ type: "image/*", expiration: "1 day", note: "images" }, { type: "*", expiration: "1 year", enabled: false }];
    // Preview proposed rules without saving them.
    const preview = await (await api("rules/preview", "POST", {
      rules,
      probes: [{ mimeType: "image/png" }, { mimeType: "video/mp4" }],
    })).json();
    assertEquals(preview.probes.map((p: { status: number; ruleIndex: number | null }) => [p.status, p.ruleIndex]), [[200, 0], [415, null]]);
    assertEquals(preview.pruneSample, null);

    // Cross-origin mutations are rejected before reaching the handler.
    const crossOrigin = await api("rules", "PUT", { version: view.version, rules }, "https://evil.example");
    assertEquals(crossOrigin.status, 403);
    await crossOrigin.body?.cancel();

    const saved = await api("rules", "PUT", { version: view.version, rules });
    assertEquals(saved.status, 200);
    const savedView = await saved.json();
    assertEquals(savedView.version, view.version + 1);

    // The very next upload preflight sees the new rules — no restart.
    const rejected = await preflight("video/mp4");
    assertEquals(rejected.status, 415);
    await rejected.body?.cancel();

    // Stale version → 409 with the current version.
    const stale = await api("rules", "PUT", { version: view.version, rules: [] });
    assertEquals(stale.status, 409);
    assertEquals((await stale.json()).version, savedView.version);

    // Validation issues are reported per field.
    const invalid = await api("rules", "PUT", { version: savedView.version, rules: [{ type: "images", expiration: "later" }] });
    assertEquals(invalid.status, 400);
    const issues = (await invalid.json()).issues.map((i: { path: string }) => i.path).sort();
    assertEquals(issues, ["rules.0.expiration", "rules.0.type"]);

    // Prune dry-run sample against the saved rules deletes nothing.
    const old = Math.floor(Date.now() / 1000) - 3 * DAY;
    await insertBlob(db, { sha256: "a".repeat(64), size: 5, type: "image/png", uploaded: old, nip94: null }, "p");
    const sample = await (await api("rules/preview", "POST", { prune: true })).json();
    assertEquals(sample.pruneSample.map((c: { sha256: string }) => c.sha256), ["a".repeat(64)]);
    assertEquals(sample.pruneSample[0].reason.ruleIndex, 0);
    assert((await db.execute("SELECT 1 FROM blobs")).rows.length === 1);

    const status = await (await api("prune/status")).json();
    assertEquals(status.enabled, true);
    assertEquals(status.running, false);

    const reset = await (await api("rules/reset-to-config", "POST", { version: savedView.version })).json();
    assertEquals(reset.rules, [{ type: "*", expiration: "1 year" }]);
  } finally {
    await cleanup();
  }
});

Deno.test("config-managed rules are read-only through the API", async () => {
  const { api, cleanup } = await setup("config");
  try {
    const view = await (await api("rules")).json();
    assertEquals(view.editable, false);
    const response = await api("rules", "PUT", { version: 0, rules: [] });
    assertEquals(response.status, 409);
    await response.body?.cancel();
    const malformed = await api("rules", "PUT", "{not json");
    assertEquals(malformed.status, 400);
    await malformed.body?.cancel();
  } finally {
    await cleanup();
  }
});
