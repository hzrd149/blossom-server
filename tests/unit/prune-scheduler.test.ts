import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { insertBlob } from "../../src/db/blobs.ts";
import { RuleStore } from "../../src/policy/rule-store.ts";
import type { PruneCandidate } from "../../src/prune/prune.ts";
import { PruneScheduler } from "../../src/prune/scheduler.ts";
import type { IBlobStorage } from "../../src/storage/interface.ts";

const DAY = 86400;

function recordingStorage(): IBlobStorage & { removed: string[] } {
  const removed: string[] = [];
  return { removed, remove: (sha256: string) => (removed.push(sha256), Promise.resolve()) } as unknown as
    & IBlobStorage
    & { removed: string[] };
}

Deno.test("scheduler dry-runs without deleting, hot-applies rule edits, and reports deletions", async () => {
  const dir = await Deno.makeTempDir({ prefix: "blossom-scheduler-" });
  const db = await initDb({ path: join(dir, "test.db") });
  try {
    const old = Math.floor(Date.now() / 1000) - 10 * DAY;
    await insertBlob(db, { sha256: "a".repeat(64), size: 10, type: "image/png", uploaded: old, nip94: null }, "p");
    await insertBlob(db, { sha256: "b".repeat(64), size: 20, type: "video/mp4", uploaded: old, nip94: null }, "p");

    const config = ConfigSchema.parse({ storage: { rulesManagement: "database", rules: [{ type: "*", expiration: "1 year" }] } });
    const rules = await RuleStore.create(db, config);
    const storage = recordingStorage();
    const deleted: PruneCandidate[] = [];
    let housekeeping = 0;
    const scheduler = new PruneScheduler(db, storage, config, rules, {
      onDeleted: (c) => deleted.push(c),
      housekeeping: () => (housekeeping++, Promise.resolve()),
    });

    // Nothing expires under the current rule.
    assertEquals((await scheduler.trigger())!.deleted, 0);

    // Proposed rules can be previewed without deleting anything.
    const preview = await scheduler.dryRun([{ type: "image/*", expiration: "1 day" }, { type: "*", expiration: "1 year" }]);
    assertEquals(preview.map((c) => c.sha256), ["a".repeat(64)]);
    assertEquals(preview[0].reason.kind, "rule");
    assertEquals(storage.removed, []);

    // A rule edit applies to the very next cycle — no restart.
    await rules.replace([{ type: "image/*", expiration: "1 day" }, { type: "*", expiration: "1 year" }], rules.version);
    const run = scheduler.trigger()!;
    assertEquals(scheduler.trigger(), null, "manual runs are single-flight");
    assertEquals((await run).deleted, 1);
    assertEquals(storage.removed, ["a".repeat(64)]);
    assertEquals(deleted.map((c) => c.sha256), ["a".repeat(64)]);
    assertEquals(scheduler.status().lastRun?.trigger, "manual");
    assertEquals(housekeeping, 2);
    await scheduler.stop();
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
