import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { Client } from "@libsql/client";
import { initDb } from "../../src/db/client.ts";
import { getBlobsForPrune, getOwnerlessBlobCandidates } from "../../src/db/blobs.ts";
import { createPruneState, pruneStorage } from "../../src/prune/prune.ts";
import type { IBlobStorage } from "../../src/storage/interface.ts";

const HOUR = 3600;
const DAY = 24 * HOUR;

function sha(n: number): string {
  return n.toString(16).padStart(64, "0");
}

/** Storage double: records what the prune engine asked it to delete. */
function recordingStorage(): IBlobStorage & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    setup: () => Promise.resolve(),
    remove: (sha256: string) => {
      removed.push(sha256);
      return Promise.resolve();
    },
    read: () => Promise.resolve(null),
    has: () => Promise.resolve(false),
    write: () => Promise.resolve(),
    commitFile: () => Promise.resolve(),
  } as unknown as IBlobStorage & { removed: string[] };
}

/**
 * A store of `count` blobs, all uploaded and accessed `ageSeconds` ago.
 * Every blob has one owner, mirroring a real server.
 */
async function seed(
  db: Client,
  count: number,
  ageSeconds: number,
  opts: { accessed?: boolean } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const t = now - ageSeconds;
  const accessed = opts.accessed ?? true;

  for (let i = 0; i < count; i++) {
    await db.execute({
      sql: "INSERT INTO blobs (sha256, size, type, uploaded) VALUES (?, ?, ?, ?)",
      args: [sha(i), 10, "image/png", t],
    });
    await db.execute({
      sql: "INSERT INTO owners (blob, pubkey) VALUES (?, ?)",
      args: [sha(i), "f".repeat(64)],
    });
    if (accessed) {
      await db.execute({
        sql: "INSERT INTO accessed (blob, timestamp) VALUES (?, ?)",
        args: [sha(i), t],
      });
    }
  }
}

async function withDb(fn: (db: Client) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  let db: Client | undefined;
  try {
    db = await initDb({ path: join(dir, "prune.db") });
    await fn(db);
  } finally {
    db?.close();
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

async function blobHashes(db: Client): Promise<string[]> {
  const rs = await db.execute("SELECT sha256 FROM blobs ORDER BY sha256");
  return rs.rows.map((row) => row[0] as string);
}

Deno.test("getBlobsForPrune returns nothing when nothing has expired", async () => {
  await withDb(async (db) => {
    await seed(db, 50, HOUR);

    // Expiry window far longer than anything in the store: the correct answer
    // is zero rows. Before the cutoff was pushed into SQL this returned every
    // blob, and the caller discarded them all — the cost of a prune cycle grew
    // with the size of the store rather than with what was actually expiring.
    const cutoff = Math.floor(Date.now() / 1000) - 365 * DAY;
    const rows = await getBlobsForPrune(db, cutoff, 1000, "accessed");

    assertEquals(rows.length, 0);
  });
});

Deno.test("getBlobsForPrune caps its result at the batch size", async () => {
  await withDb(async (db) => {
    await seed(db, 50, 30 * DAY);

    const cutoff = Math.floor(Date.now() / 1000);
    const rows = await getBlobsForPrune(db, cutoff, 10, "accessed");

    assertEquals(rows.length, 10);
  });
});

Deno.test("getBlobsForPrune falls back to upload time when never accessed", async () => {
  await withDb(async (db) => {
    await seed(db, 5, 30 * DAY, { accessed: false });

    const now = Math.floor(Date.now() / 1000);
    assertEquals(
      (await getBlobsForPrune(db, now - 60 * DAY, 1000, "uploaded")).length,
      0,
    );

    const expired = await getBlobsForPrune(db, now, 1000, "uploaded");
    assertEquals(expired.length, 5);
    // Reported as never accessed, so the caller's own guard uses `uploaded`.
    assertEquals(expired.every((r) => r.accessed === null), true);
  });
});

Deno.test("getBlobsForPrune returns one row per blob, not one per owner", async () => {
  await withDb(async (db) => {
    await seed(db, 3, 30 * DAY);
    const pubkeys = ["a".repeat(64), "b".repeat(64)];
    for (const sha256 of [sha(0), sha(1), sha(2)]) {
      for (const pubkey of pubkeys) {
        await db.execute({
          sql: "INSERT INTO owners (blob, pubkey) VALUES (?, ?)",
          args: [sha256, pubkey],
        });
      }
    }

    // Both pubkeys own all three blobs. Joining owners would yield six rows and
    // burn six of the caller's batch slots on three blobs.
    const rows = await getBlobsForPrune(db, Math.floor(Date.now() / 1000), 1000, "accessed");

    assertEquals(rows.length, 3);
    assertEquals(new Set(rows.map((r) => r.sha256)).size, 3);
    assertEquals(rows.every((row) => pubkeys.every((pubkey) => row.owners.includes(pubkey))), true);
  });
});

Deno.test("pruneStorage deletes nothing under a long expiry window", async () => {
  await withDb(async (db) => {
    await seed(db, 25, HOUR);
    const storage = recordingStorage();

    const result = await pruneStorage(
      db,
      storage,
      [{ type: "*", expiration: "100 years" }],
      false,
    );

    assertEquals(result, { deleted: 0, errors: 0 });
    assertEquals(storage.removed.length, 0);
    const left = await db.execute("SELECT count(*) FROM blobs");
    assertEquals(Number(left.rows[0][0]), 25);
  });
});

Deno.test("pruneStorage deletes expired blobs, bounded by batch size", async () => {
  await withDb(async (db) => {
    await seed(db, 25, 30 * DAY);
    const storage = recordingStorage();

    const result = await pruneStorage(
      db,
      storage,
      [{ type: "*", expiration: "7 days" }],
      false,
      10,
    );

    assertEquals(result.deleted, 10);
    assertEquals(result.errors, 0);
    assertEquals(storage.removed.length, 10);

    // The remainder is not lost, just deferred to the next cycle.
    const left = await db.execute("SELECT count(*) FROM blobs");
    assertEquals(Number(left.rows[0][0]), 15);
  });
});

Deno.test("getOwnerlessBlobCandidates bounds examined rows", async () => {
  await withDb(async (db) => {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 20; i++) {
      await db.execute({
        sql: "INSERT INTO blobs (sha256, size, type, uploaded) VALUES (?, ?, ?, ?)",
        args: [sha(i), 10, "image/png", now],
      });
    }

    assertEquals((await getOwnerlessBlobCandidates(db, 5)).length, 5);
    assertEquals((await getOwnerlessBlobCandidates(db, 1000)).length, 20);
  });
});

Deno.test("pruneStorage preserves first-match retention semantics", async () => {
  await withDb(async (db) => {
    await seed(db, 1, 14 * DAY);
    const storage = recordingStorage();

    const result = await pruneStorage(
      db,
      storage,
      [
        { type: "image/*", expiration: "1 month" },
        { type: "*", expiration: "1 week" },
      ],
      false,
      10,
      createPruneState(),
    );

    assertEquals(result, { deleted: 0, errors: 0 });
    assertEquals(Number((await db.execute("SELECT COUNT(*) FROM blobs")).rows[0][0]), 1);
  });
});

Deno.test("pruneStorage preserves first-match pubkey retention semantics", async () => {
  await withDb(async (db) => {
    await seed(db, 1, 14 * DAY);
    await db.execute({
      sql: "INSERT INTO owners (blob, pubkey) VALUES (?, ?)",
      args: [sha(0), "a".repeat(64)],
    });
    const storage = recordingStorage();

    const result = await pruneStorage(
      db,
      storage,
      [
        { type: "*", expiration: "1 month", pubkeys: ["a".repeat(64)] },
        { type: "*", expiration: "1 week" },
      ],
      false,
      10,
      createPruneState(),
    );

    assertEquals(result, { deleted: 0, errors: 0 });
    assertEquals(Number((await db.execute("SELECT COUNT(*) FROM blobs")).rows[0][0]), 1);
  });
});

Deno.test("pruneStorage advances past candidates governed by earlier rules", async () => {
  await withDb(async (db) => {
    await seed(db, 2, 14 * DAY);
    await db.execute({
      sql: "UPDATE blobs SET type = ? WHERE sha256 = ?",
      args: ["video/mp4", sha(1)],
    });
    const storage = recordingStorage();
    const state = createPruneState();
    const rules = [
      { type: "image/*", expiration: "1 month" },
      { type: "*", expiration: "1 week" },
    ];

    assertEquals((await pruneStorage(db, storage, rules, false, 1, state)).deleted, 0);
    assertEquals((await pruneStorage(db, storage, rules, false, 1, state)).deleted, 0);
    assertEquals((await pruneStorage(db, storage, rules, false, 1, state)).deleted, 1);
    assertEquals(await blobHashes(db), [sha(0)]);
  });
});

Deno.test("pruneStorage advances past deletion failures", async () => {
  await withDb(async (db) => {
    await seed(db, 2, 30 * DAY);
    await db.execute(`
      CREATE TRIGGER reject_first_prune
      BEFORE DELETE ON blobs
      WHEN OLD.sha256 = '${sha(0)}'
      BEGIN
        SELECT RAISE(ABORT, 'simulated delete failure');
      END
    `);
    const storage = recordingStorage();
    const state = createPruneState();
    const rules = [{ type: "*", expiration: "1 week" }];

    const first = await pruneStorage(db, storage, rules, false, 1, state);
    const second = await pruneStorage(db, storage, rules, false, 1, state);
    const third = await pruneStorage(db, storage, rules, false, 1, state);

    assertEquals(first, { deleted: 0, errors: 1 });
    assertEquals(second, { deleted: 0, errors: 0 });
    assertEquals(third, { deleted: 1, errors: 0 });
    assertEquals(await blobHashes(db), [sha(0)]);
  });
});

Deno.test("pruneStorage advances past deletion failures for never-accessed blobs", async () => {
  await withDb(async (db) => {
    await seed(db, 2, 30 * DAY, { accessed: false });
    await db.execute(`
      CREATE TRIGGER reject_first_uploaded_prune
      BEFORE DELETE ON blobs
      WHEN OLD.sha256 = '${sha(0)}'
      BEGIN
        SELECT RAISE(ABORT, 'simulated delete failure');
      END
    `);
    const storage = recordingStorage();
    const state = createPruneState();
    const rules = [{ type: "*", expiration: "1 week" }];

    const first = await pruneStorage(db, storage, rules, false, 1, state);
    const second = await pruneStorage(db, storage, rules, false, 1, state);

    assertEquals(first, { deleted: 0, errors: 1 });
    assertEquals(second, { deleted: 1, errors: 0 });
    assertEquals(await blobHashes(db), [sha(0)]);
  });
});

Deno.test("ownerless cleanup advances through bounded candidate pages", async () => {
  await withDb(async (db) => {
    await seed(db, 3, HOUR);
    await db.execute({
      sql: "DELETE FROM owners WHERE blob = ?",
      args: [sha(2)],
    });
    const storage = recordingStorage();
    const state = createPruneState();

    assertEquals((await pruneStorage(db, storage, [], true, 2, state)).deleted, 0);
    assertEquals((await pruneStorage(db, storage, [], true, 2, state)).deleted, 1);
    assertEquals(await blobHashes(db), [sha(0), sha(1)]);
  });
});

Deno.test("ownerless cleanup advances past deletion failures", async () => {
  await withDb(async (db) => {
    await seed(db, 2, HOUR);
    await db.execute("DELETE FROM owners");
    await db.execute(`
      CREATE TRIGGER reject_first_ownerless_prune
      BEFORE DELETE ON blobs
      WHEN OLD.sha256 = '${sha(0)}'
      BEGIN
        SELECT RAISE(ABORT, 'simulated delete failure');
      END
    `);
    const storage = recordingStorage();
    const state = createPruneState();

    const first = await pruneStorage(db, storage, [], true, 1, state);
    const second = await pruneStorage(db, storage, [], true, 1, state);

    assertEquals(first, { deleted: 0, errors: 1 });
    assertEquals(second, { deleted: 1, errors: 0 });
    assertEquals(await blobHashes(db), [sha(0)]);
  });
});
