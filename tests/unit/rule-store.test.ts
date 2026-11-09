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
