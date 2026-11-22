import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parseConfigText } from "../../src/config/loader.ts";
import { initDb } from "../../src/db/client.ts";
import { insertBlob } from "../../src/db/blobs.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";

const password = "rules-test-password";
const authorization = `Basic ${btoa(`admin:${password}`)}`;
const DAY = 86400;

const CONFIG_YAML = `# Test server config
landing:
  # Title comes from the environment
  title: "\${BLOSSOM_TEST_UNSET_TITLE}"
dashboard:
  enabled: true
  password: ${password}
upload:
  requireAuth: false
storage:
  # Retention rules (managed from the admin console)
  rules:
    - type: "*"
      expiration: 1 year
`;

async function setup({ writable = true } = {}) {
  const dir = await Deno.makeTempDir({ prefix: "blossom-admin-rules-" });
  const db = await initDb({ path: join(dir, "test.db") });
  const storage = new LocalStorage(join(dir, "blobs"));
  await storage.setup();
  const configPath = join(dir, "config.yml");
  await Deno.writeTextFile(configPath, CONFIG_YAML);
  if (!writable) await Deno.chmod(configPath, 0o444);
  const config = parseConfigText(CONFIG_YAML, { quiet: true });
  const app = await buildApp(db, storage, config, { configPath });
  const api = (path: string, method = "GET", body?: unknown, origin = "http://localhost") =>
    app.fetch(
      new Request(`http://localhost/admin/api/${path}`, {
        method,
        headers: { Authorization: authorization, Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const preflight = (type: string) =>
    app.fetch(new Request("http://localhost/upload", { method: "HEAD", headers: { "X-Content-Type": type, "X-Content-Length": "10" } }));
  const readConfig = () => Deno.readTextFile(configPath);
  const cleanup = async () => {
    db.close();
    await Deno.remove(dir, { recursive: true });
  };
  return { db, api, preflight, readConfig, configPath, cleanup };
}

Deno.test("rules are saved to a writable config.yml and hot-applied to uploads", async () => {
  const { db, api, preflight, readConfig, configPath, cleanup } = await setup();
  try {
    const view = await (await api("rules")).json();
    assertEquals(view.rules, [{ type: "*", expiration: "1 year" }]);
    assertEquals(view.configFile.path, configPath);
    assertEquals(view.configFile.writable, true);
    assertEquals(view.configFile.inSync, true);
    assertEquals(view.configFile.error, null);

    const rules = [{ type: "image/*", expiration: "1 day", note: "images" }, { type: "*", expiration: "1 year", enabled: false }];
    // Preview proposed rules without saving them.
    const preview = await (await api("rules/preview", "POST", {
      rules,
      probes: [{ mimeType: "image/png" }, { mimeType: "video/mp4" }],
    })).json();
    assertEquals(preview.probes.map((p: { status: number; ruleIndex: number | null }) => [p.status, p.ruleIndex]), [[200, 0], [415, null]]);
    assertEquals(preview.pruneSample, null);

    // Cross-origin mutations are rejected before reaching the handler.
    const crossOrigin = await api("rules", "PUT", { hash: view.configFile.hash, rules }, "https://evil.example");
    assertEquals(crossOrigin.status, 403);
    await crossOrigin.body?.cancel();

    // Validation issues are reported per field, and nothing is written.
    const invalid = await api("rules", "PUT", { hash: view.configFile.hash, rules: [{ type: "images", expiration: "later" }] });
    assertEquals(invalid.status, 400);
    const issues = (await invalid.json()).issues.map((i: { path: string }) => i.path).sort();
    assertEquals(issues, ["rules.0.expiration", "rules.0.type"]);
    assertEquals(await readConfig(), CONFIG_YAML);

    const saved = await api("rules", "PUT", { hash: view.configFile.hash, rules });
    assertEquals(saved.status, 200);
    const savedView = await saved.json();
    assertEquals(savedView.rules, rules);
    assert(savedView.version > view.version);
    assert(savedView.configFile.hash !== view.configFile.hash);
    assertEquals(savedView.configFile.inSync, true);

    // The file keeps its comments and uninterpolated placeholders.
    const text = await readConfig();
    assertStringIncludes(text, "# Test server config");
    assertStringIncludes(text, "# Retention rules (managed from the admin console)");
    assertStringIncludes(text, "${BLOSSOM_TEST_UNSET_TITLE}");
    assertStringIncludes(text, "note: images");
    assertStringIncludes(text, "enabled: false");

    // The very next upload preflight sees the new rules — no restart.
    const rejected = await preflight("video/mp4");
    assertEquals(rejected.status, 415);
    await rejected.body?.cancel();

    // A stale hash (the file changed since it was read) is a conflict and writes nothing.
    const stale = await api("rules", "PUT", { hash: view.configFile.hash, rules: [] });
    assertEquals(stale.status, 409);
    await stale.body?.cancel();
    assertEquals(await readConfig(), text);

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

    // A hand edit is detected and can be applied without a restart.
    await Deno.writeTextFile(configPath, text.replace("expiration: 1 day", "expiration: 2 days"));
    const drifted = await (await api("rules")).json();
    assertEquals(drifted.configFile.inSync, false);
    const reloaded = await (await api("rules/reload", "POST")).json();
    assertEquals(reloaded.rules[0].expiration, "2 days");
    assertEquals(reloaded.configFile.inSync, true);

    // An invalid hand edit is reported and not applied.
    await Deno.writeTextFile(configPath, "storage: [");
    assertStringIncludes((await (await api("rules")).json()).configFile.error, "(yaml)");
    const badReload = await api("rules/reload", "POST");
    assertEquals(badReload.status, 400);
    await badReload.body?.cancel();
    assertEquals((await (await api("rules")).json()).rules[0].expiration, "2 days");
  } finally {
    await cleanup();
  }
});

Deno.test("read-only config.yml cannot be written but renders the full updated file", async () => {
  if (Deno.uid() === 0) return; // root ignores file modes
  const { api, readConfig, cleanup } = await setup({ writable: false });
  try {
    const view = await (await api("rules")).json();
    assertEquals(view.configFile.writable, false);
    assertEquals(view.configFile.exists, true);

    const rules = [{ type: "image/*", expiration: "1 week", pubkeys: ["b".repeat(64)] }];
    const response = await api("rules", "PUT", { hash: view.configFile.hash, rules });
    assertEquals(response.status, 409);
    await response.body?.cancel();
    assertEquals(await readConfig(), CONFIG_YAML);

    const rendered = await (await api("rules/render", "POST", { rules })).json();
    assertEquals(rendered.hash, view.configFile.hash);
    assertStringIncludes(rendered.text, "# Test server config");
    assertStringIncludes(rendered.text, "${BLOSSOM_TEST_UNSET_TITLE}");
    assertStringIncludes(rendered.text, "type: image/*");
    assert(!rendered.text.includes("1 year"));
    assertStringIncludes(rendered.snippet, "storage:\n  rules:\n");
    assert(!rendered.snippet.includes("dashboard"));

    const malformed = await api("rules", "PUT", "{not json");
    assertEquals(malformed.status, 400);
    await malformed.body?.cancel();
  } finally {
    await cleanup();
  }
});
