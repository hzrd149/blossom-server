import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { npubEncode } from "nostr-tools/nip19";
import { parseConfigText } from "../../src/config/loader.ts";
import { initDb } from "../../src/db/client.ts";
import { getBlob, insertBlob } from "../../src/db/blobs.ts";
import { insertReport, listAllReports } from "../../src/db/reports.ts";
import { buildApp } from "../../src/server.ts";
import { createServerRuntime, stopServerRuntime } from "../../src/runtime.ts";
import { LocalStorage } from "../../src/storage/local.ts";

const password = "moderation-test-password";
const authorization = `Basic ${btoa(`admin:${password}`)}`;

const CONFIG_YAML = `# Moderation test config
dashboard:
  enabled: true
  password: ${password}
landing:
  enabled: false
upload:
  requireAuth: false
`;

const h = (n: number) => n.toString(16).padStart(64, "0");

async function setup() {
  const dir = await Deno.makeTempDir({ prefix: "blossom-admin-moderation-" });
  const db = await initDb({ path: join(dir, "test.db") });
  const storage = new LocalStorage(join(dir, "blobs"));
  await storage.setup();
  const configPath = join(dir, "config.yml");
  await Deno.writeTextFile(configPath, CONFIG_YAML);
  const config = parseConfigText(CONFIG_YAML, { quiet: true });
  const runtime = await createServerRuntime(db, storage, config);
  const app = await buildApp(db, storage, config, { configPath, runtime });
  const api = (path: string, method = "GET", body?: unknown) =>
    app.fetch(
      new Request(`http://localhost/admin/api/${path}`, {
        method,
        headers: { Authorization: authorization, Origin: "http://localhost", "Content-Type": "application/json" },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const json = async (path: string, method = "GET", body?: unknown, status = 200) => {
    const res = await api(path, method, body);
    const data = await res.json();
    assertEquals(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const store = async (sha256: string, owners: string[], type = "image/png") => {
    for (const owner of owners) await insertBlob(db, { sha256, size: 4, type, uploaded: 1000, nip94: null }, owner);
  };
  const cleanup = async () => {
    await stopServerRuntime(runtime);
    db.close();
    await Deno.remove(dir, { recursive: true });
  };
  return { db, runtime, api, json, store, cleanup };
}

Deno.test("admin moderation: pubkey bans with keep and ownership-only removal", async () => {
  const { db, runtime, api, json, store, cleanup } = await setup();
  try {
    const user = "c".repeat(64), other = "d".repeat(64);
    await store(h(1), [user]);
    await store(h(2), [user, other]);

    const invalid = await api("bans/pubkeys", "POST", { pubkey: "nope" });
    assertEquals(invalid.status, 400);
    assertEquals((await invalid.json()).issues[0].path, "pubkey");

    const kept = await json("bans/pubkeys", "POST", { pubkey: npubEncode(user), reason: "spam", note: " noisy " });
    assertEquals(kept, { pubkey: user, removedOwnership: 0, deleted: [] });
    assert(runtime.moderation.isPubkeyBanned(user));
    const list = await json("bans/pubkeys?q=noisy");
    assertEquals(list.total, 1);
    assertEquals([list.items[0].pubkey, list.items[0].reason, list.items[0].note], [user, "spam", "noisy"]);
    assertEquals((await json(`bans/pubkeys/${npubEncode(user)}`)).ban.pubkey, user);
    // Searching by npub matches the hex pubkey.
    assertEquals((await json(`bans/pubkeys?q=${npubEncode(user)}`)).total, 1);
    assertEquals((await json(`bans/pubkeys?q=${npubEncode(other)}`)).total, 0);
    assertEquals((await json(`bans/pubkeys/${other}`)).ban, null);

    // Users list and detail carry the ban flag.
    const users = await json("users");
    assertEquals(Object.fromEntries(users.items.map((u: { pubkey: string; banned: boolean }) => [u.pubkey, u.banned])), {
      [user]: true,
      [other]: false,
    });
    assertEquals((await json(`users/${user}`)).banned, true);

    // Re-banning with "remove" drops ownership; only the orphaned blob is deleted.
    const removed = await json("bans/pubkeys", "POST", { pubkey: user, content: "remove" });
    assertEquals(removed.removedOwnership, 2);
    assertEquals(removed.deleted, [h(1)]);
    assertEquals(await getBlob(db, h(1)), null);
    assert(await getBlob(db, h(2)));

    assertEquals(await json(`bans/pubkeys/${user}`, "DELETE"), { success: true });
    assert(!runtime.moderation.isPubkeyBanned(user));
    await json(`bans/pubkeys/${user}`, "DELETE", undefined, 404);
    await json("bans/pubkeys/xyz", "DELETE", undefined, 400);
  } finally {
    await cleanup();
  }
});

Deno.test("admin moderation: blob bans, report ban-blob action, and blob status", async () => {
  const { db, json, api, store, cleanup } = await setup();
  try {
    const owner = "e".repeat(64), reporter = "f".repeat(64);
    await store(h(10), [owner]);
    await store(h(11), [owner]);
    await store(h(12), [owner]);

    assertEquals((await json(`moderation/blobs/${h(10)}`)).stored, true);

    // A blob URL is accepted in place of the hash.
    const banned = await json("bans/blobs", "POST", { sha256: `https://cdn.example.com/${h(10)}.png`, category: "malware", note: "bad" });
    assertEquals(banned.banned, [h(10)]);
    assertEquals(banned.deleted, [h(10)]);
    assertEquals(await getBlob(db, h(10)), null);
    const status = await json(`moderation/blobs/${h(10)}`);
    assertEquals([status.stored, status.ban.category, status.ban.note], [false, "malware", "bad"]);
    assertEquals((await json(`moderation/blobs/${h(11)}`)).ban, null);
    assertEquals((await json("bans/blobs?category=malware")).total, 1);
    assertEquals((await json("bans/blobs?category=spam")).total, 0);
    assertEquals((await json("bans/blobs?q=bad")).total, 1);
    const badCategory = await api("bans/blobs", "POST", { sha256: h(11), category: "rude" });
    assertEquals(badCategory.status, 400);
    await badCategory.body?.cancel();

    // Report actions: the category defaults to the report type, else "other"; an explicit category wins.
    const report = (n: number, blob: string, type: "nudity" | "spam" | null) =>
      insertReport(db, { event_id: h(100 + n), reporter, blob, type, content: "", created: 1 });
    await report(1, h(11), "nudity");
    await report(2, h(12), null);
    await report(3, h(12), "spam");
    const reports = await listAllReports(db, { limit: 10 });
    const idFor = (eventId: string) => reports.find((r) => r.event_id === eventId)!.id;

    const fromReport = await json(`reports/${idFor(h(101))}/ban-blob`, "POST");
    assertEquals([fromReport.success, fromReport.banned, fromReport.reportsResolved], [true, [h(11)], 0]);
    assertEquals((await json(`moderation/blobs/${h(11)}`)).ban.category, "nudity");
    await json(`reports/${idFor(h(102))}/ban-blob`, "POST");
    assertEquals((await json(`moderation/blobs/${h(12)}`)).ban.category, "other");
    // All reports survive bans and remain actionable.
    assertEquals((await listAllReports(db, { limit: 10 })).map((r) => r.dismissed), [false, false, false]);
    await json(`reports/${idFor(h(103))}/ban-blob`, "POST", { category: "spam" });
    await json("reports/999/nope", "POST", undefined, 404);

    assertEquals(await json(`bans/blobs/${h(10)}`, "DELETE"), { success: true });
    assertEquals((await json(`moderation/blobs/${h(10)}`)).ban, null);
    await json(`bans/blobs/${h(10)}`, "DELETE", undefined, 404);
  } finally {
    await cleanup();
  }
});
