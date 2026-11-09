import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { initDb, runMigrations } from "../../src/db/client.ts";
import { insertBlob } from "../../src/db/blobs.ts";

const blob = (sha256: string, uploaded: number) => ({ sha256, size: 1, type: "image/png", uploaded, nip94: null });

Deno.test("migrations are recorded once and owner upload time is per owner", async () => {
  const dir = await Deno.makeTempDir({ prefix: "blossom-migrations-" });
  const db = await initDb({ path: join(dir, "test.db") });
  try {
    const applied = (await db.execute("SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r[0]);
    assertEquals(applied.includes("001_initial.sql"), true);
    assertEquals(applied.includes("007_owner_uploaded.sql"), true);

    // A dedup grant to a second owner records the grant time, not the first upload time.
    await insertBlob(db, blob("a".repeat(64), 1_000), "p1", 1_000);
    await insertBlob(db, blob("a".repeat(64), 1_000), "p2", 5_000);
    await insertBlob(db, blob("b".repeat(64), 2_000), "p1");
    const rows = (await db.execute("SELECT pubkey, uploaded FROM owners WHERE blob = ? ORDER BY pubkey", ["a".repeat(64)]))
      .rows.map((r) => [r[0], r[1]]);
    assertEquals(rows, [["p1", 1_000], ["p2", 5_000]]);
    const defaulted = (await db.execute("SELECT uploaded FROM owners WHERE blob = ?", ["b".repeat(64)])).rows[0][0] as number;
    assertEquals(Math.abs(defaulted - Date.now() / 1000) < 60, true);

    // Re-running is a no-op: tracked files are skipped (the backfill would otherwise re-run).
    await db.execute("UPDATE owners SET uploaded = NULL WHERE pubkey = 'p2'");
    await runMigrations(db);
    assertEquals((await db.execute("SELECT uploaded FROM owners WHERE pubkey = 'p2'")).rows[0][0], null);
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("pre-tracking databases backfill owners.uploaded on upgrade", async () => {
  const dir = await Deno.makeTempDir({ prefix: "blossom-migrations-" });
  const db = await initDb({ path: join(dir, "test.db") });
  try {
    // Simulate a database from before migration tracking and 007.
    await db.execute("INSERT INTO blobs (sha256, size, type, uploaded) VALUES (?, 1, NULL, 1234)", ["c".repeat(64)]);
    await db.execute("INSERT INTO owners (blob, pubkey, uploaded) VALUES (?, 'p', NULL)", ["c".repeat(64)]);
    await db.execute("DROP TABLE schema_migrations");
    await runMigrations(db);
    assertEquals((await db.execute("SELECT uploaded FROM owners WHERE pubkey = 'p'")).rows[0][0], 1234);
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
