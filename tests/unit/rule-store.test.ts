import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import type { Client } from "@libsql/client";
import { ZodError } from "zod";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { RulesVersionConflict } from "../../src/db/storage-rules.ts";
import { RulesNotEditableError, RuleStore } from "../../src/policy/rule-store.ts";

async function withDb(fn: (db: Client, path: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "blossom-rules-" });
  const path = join(dir, "test.db");
  const db = await initDb({ path });
  try {
    await fn(db, path);
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
}

const configRules = [{ type: "image/*", expiration: "1 month" }, { type: "*", expiration: "1 week" }];
const dbConfig = (rules = configRules) => ConfigSchema.parse({ storage: { rulesManagement: "database", rules } });

Deno.test("config mode exposes config rules read-only", async () => {
  await withDb(async (db) => {
    const store = await RuleStore.create(db, ConfigSchema.parse({ storage: { rules: configRules } }));
    assertEquals(store.editable, false);
    assertEquals(store.current(), configRules);
    await assertRejects(() => store.replace([]), RulesNotEditableError);
  });
});

Deno.test("database mode seeds once, then database rules win over later config edits", async () => {
  await withDb(async (db) => {
    const store = await RuleStore.create(db, dbConfig());
    assertEquals(store.current(), configRules);
    assertEquals(store.version, 1);

    const changed: number[] = [];
    store.onChange((version) => changed.push(version));
    const version = await store.replace([
      { type: "video/*", expiration: "3 days", basis: "uploaded", note: "short video retention" },
      { type: "*", expiration: "1 week", enabled: false },
    ], 1);
    assertEquals(version, 2);
    assertEquals(changed, [2]);
    // Disabled rules are kept for editing but excluded from evaluation.
    assertEquals(store.current(), [{ type: "video/*", expiration: "3 days", basis: "uploaded" }]);
    assertEquals(store.entries().length, 2);

    const restarted = await RuleStore.create(db, dbConfig([{ type: "*", expiration: "1 year" }]));
    assertEquals(restarted.current(), [{ type: "video/*", expiration: "3 days", basis: "uploaded" }]);

    await restarted.resetToConfig();
    assertEquals(restarted.current(), [{ type: "*", expiration: "1 year" }]);
  });
});

Deno.test("stale versions conflict and invalid rules are rejected without writing", async () => {
  await withDb(async (db) => {
    const store = await RuleStore.create(db, dbConfig());
    await assertRejects(() => store.replace([{ type: "*", expiration: "1 day" }], 0), RulesVersionConflict);
    for (
      const bad of [
        [{ type: "image", expiration: "1 day" }],
        [{ type: "*", expiration: "soon" }],
        [{ type: "*", expiration: "0 days" }],
        [{ type: "*", expiration: "1 day", pubkeys: ["npub1notahexkey"] }],
        Array.from({ length: 101 }, () => ({ type: "*", expiration: "1 day" })),
      ]
    ) {
      await assertRejects(() => store.replace(bad, 1), ZodError);
    }
    assertEquals(store.version, 1);
    assertEquals(store.current(), configRules);
  });
});

Deno.test("nip05Domains are normalized, persisted, and survive a restart; disabled rules contribute no domains", async () => {
  await withDb(async (db) => {
    const store = await RuleStore.create(db, dbConfig());
    await store.replace([
      { type: "image/*", expiration: "1 month", nip05Domains: [" Example.ORG", "bücher.example"] },
      { type: "*", expiration: "1 week", nip05Domains: ["disabled.example"], enabled: false },
    ], 1);

    assertEquals(store.entries()[0].nip05Domains, ["example.org", "xn--bcher-kva.example"]);
    assertEquals(store.nip05Domains(), ["example.org", "xn--bcher-kva.example"]);

    const restarted = await RuleStore.create(db, dbConfig());
    assertEquals(restarted.entries()[0].nip05Domains, ["example.org", "xn--bcher-kva.example"]);
    assertEquals(restarted.entries()[1].nip05Domains, ["disabled.example"]);
    // No members fetched yet: the rule is served with an empty (closed) allowlist.
    assertEquals(restarted.current(), [{ type: "image/*", expiration: "1 month", nip05Domains: ["example.org", "xn--bcher-kva.example"], pubkeys: [] }]);

    for (const bad of ["https://example.org", "example.org/", "user:pw@example.org", ""]) {
      await assertRejects(() => store.replace([{ type: "*", expiration: "1 day", nip05Domains: [bad] }], 2), ZodError);
    }
    assertEquals(store.version, 2);
  });
});

Deno.test("fetched NIP-05 members are served by current() but never persisted or bump the version", async () => {
  await withDb(async (db) => {
    const member = "a".repeat(64);
    const owner = "b".repeat(64);
    const store = await RuleStore.create(db, dbConfig());
    await store.replace([{ type: "*", expiration: "1 week", pubkeys: [owner], nip05Domains: ["example.org"] }], 1);
    const changed: number[] = [];
    store.onChange((version) => changed.push(version));

    store.setNip05Members(new Map([["example.org", new Set([member])]]));
    assertEquals(store.current()[0].pubkeys, [owner, member]);
    assertEquals(store.entries()[0].pubkeys, [owner]);
    assertEquals(store.version, 2);
    assertEquals(changed, []);
    // The preview path merges the same members into unsaved rules.
    assertEquals(store.resolve([{ type: "image/*", expiration: "1 day", nip05Domains: ["example.org"] }])[0].pubkeys, [member]);

    // Members stay applied across an edit, and the database holds only the static pubkeys.
    await store.replace([{ type: "image/*", expiration: "1 week", nip05Domains: ["example.org"] }], 2);
    assertEquals(store.current()[0].pubkeys, [member]);
    const restarted = await RuleStore.create(db, dbConfig());
    assertEquals(restarted.entries()[0].pubkeys, undefined);
    assertEquals(restarted.current()[0].pubkeys, []);
  });
});
