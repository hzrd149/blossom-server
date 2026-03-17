/**
 * legacy-migration.ts
 *
 * Auto-detects and migrates a legacy Node.js blossom-server SQLite database to
 * the Deno server schema on startup. This file is intentionally self-contained
 * so it can be deleted wholesale when legacy migration support is no longer
 * needed — nothing else in the codebase depends on it except the call-site in
 * main.ts.
 *
 * WHEN IT RUNS
 * ────────────
 * Only for local SQLite files (not remote libSQL / Turso). Called from main.ts
 * before initDb() opens the file. If the file does not exist, or is already on
 * the Deno schema, the function is a fast no-op.
 *
 * DETECTION
 * ─────────
 * The legacy `owners` table has a surrogate `id INTEGER PRIMARY KEY
 * AUTOINCREMENT` column. The Deno schema uses a composite PRIMARY KEY (blob,
 * pubkey) with no id column. We query sqlite_master for the CREATE TABLE
 * statement and check for the presence of the `id` column name.
 *
 * WHAT THE MIGRATION DOES
 * ───────────────────────
 *   1. Reads all rows from blobs, owners (de-duplicated), accessed.
 *   2. Renames the legacy file to <path>.bak (atomic, same filesystem).
 *   3. Creates a fresh file at <path> via the Deno initDb() path so the schema
 *      is guaranteed correct: composite PK on owners, ON DELETE CASCADE,
 *      media_derivatives table, WAL mode.
 *   4. Imports all rows. Strips "; charset=…" parameter suffixes from type
 *      values to produce clean bare MIME types consistent with new uploads.
 *   5. Verifies row counts. On mismatch: restores the backup and aborts.
 *
 * REMOVAL
 * ───────
 * When the Node.js server is fully retired:
 *   - Delete this file (src/db/legacy-migration.ts)
 *   - Remove the import and the maybeMigrateLegacyDb() call from main.ts
 *   - Remove the "migrate-from-legacy" task from deno.json (if still present)
 *   - Delete scripts/migrate-from-legacy.ts (if still present)
 */

import { createClient } from "@libsql/client";
import { initDb, type DbConfig } from "./client.ts";

// ---------------------------------------------------------------------------
// Public API — single entry point
// ---------------------------------------------------------------------------

/**
 * If `dbPath` points at a legacy Node.js blossom-server SQLite database,
 * migrate it in-place to the Deno schema. Otherwise do nothing.
 *
 * Safe to call unconditionally on every startup:
 *   - File missing → no-op (initDb will create it fresh)
 *   - Already Deno schema → no-op (fast schema check, no data read)
 *   - Legacy schema → runs migration, prints progress, exits on failure
 *
 * @param dbPath   Absolute or CWD-relative path to the SQLite file.
 * @param dbConfig Full DbConfig used to open the fresh DB via initDb().
 */
export async function maybeMigrateLegacyDb(
  dbPath: string,
  dbConfig: DbConfig,
): Promise<void> {
  // Skip if the file does not exist — initDb() will create it fresh.
  try {
    await Deno.stat(dbPath);
  } catch {
    return;
  }

  // Detect legacy schema — fast check, no rows read.
  const isLegacy = await detectLegacySchema(dbPath);
  if (!isLegacy) return;

  // Run migration.
  await runMigration(dbPath, dbConfig);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the SQLite file at `dbPath` has the legacy Node.js schema.
 *
 * Detection heuristic: the legacy `owners` table CREATE statement contains an
 * `id` column (INTEGER PRIMARY KEY AUTOINCREMENT). The Deno schema has no such
 * column — it uses a composite PRIMARY KEY (blob, pubkey) instead.
 */
async function detectLegacySchema(dbPath: string): Promise<boolean> {
  const client = createClient({ url: `file:${dbPath}` });
  try {
    const rs = await client.execute(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'owners'`,
    );
    const sql = (rs.rows[0]?.[0] as string | null) ?? "";
    // The legacy schema has an `id` column; the Deno schema does not.
    return /\bid\b/.test(sql);
  } catch {
    // If sqlite_master is unreadable the file is corrupt — let initDb() handle it.
    return false;
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

async function runMigration(dbPath: string, dbConfig: DbConfig): Promise<void> {
  const backupPath = `${dbPath}.bak`;
  const startedAt = Date.now();

  const log = (msg: string) => console.log(`  [legacy-migration] ${msg}`);
  const err = (msg: string) => console.error(`  [legacy-migration] ${msg}`);

  console.log("");
  log("━━━ Legacy Node.js database detected ━━━");
  log(`Source:  ${dbPath}`);
  log(`Backup:  ${backupPath}`);
  console.log("");

  // ------------------------------------------------------------------
  // Step 1 — Read all data from the legacy DB
  // ------------------------------------------------------------------

  log("Step 1/5 — Reading legacy data");

  const legacy = createClient({ url: `file:${dbPath}` });

  const [blobsRs, ownersRs, accessedRs] = await Promise.all([
    legacy.execute("SELECT sha256, type, size, uploaded FROM blobs"),
    legacy.execute("SELECT blob, pubkey FROM owners"),
    legacy.execute("SELECT blob, timestamp FROM accessed"),
  ]);

  const blobs = blobsRs.rows.map((r) => ({
    sha256: r[0] as string,
    type: r[1] as string | null,
    size: r[2] as number,
    uploaded: r[3] as number,
  }));

  // De-duplicate (blob, pubkey) pairs — the legacy schema permits duplicates
  // because owners uses a surrogate PK rather than a composite one.
  const ownersSeen = new Set<string>();
  const owners: { blob: string; pubkey: string }[] = [];
  for (const r of ownersRs.rows) {
    const blob = r[0] as string;
    const pubkey = r[1] as string;
    const key = `${blob}:${pubkey}`;
    if (!ownersSeen.has(key)) {
      ownersSeen.add(key);
      owners.push({ blob, pubkey });
    }
  }

  const accessed = accessedRs.rows.map((r) => ({
    blob: r[0] as string,
    timestamp: r[1] as number,
  }));

  legacy.close();

  const duplicatesRemoved = ownersRs.rows.length - owners.length;
  log(`         blobs:    ${blobs.length}`);
  log(
    `         owners:   ${owners.length}` +
      (duplicatesRemoved > 0 ? ` (${duplicatesRemoved} duplicate rows removed)` : ""),
  );
  log(`         accessed: ${accessed.length}`);

  // ------------------------------------------------------------------
  // Step 2 — Backup the legacy file
  // ------------------------------------------------------------------

  log("Step 2/5 — Backing up legacy database");
  await Deno.rename(dbPath, backupPath);
  log(`         sqlite.db → sqlite.db.bak`);

  // ------------------------------------------------------------------
  // Step 3 — Create fresh DB with Deno schema
  // ------------------------------------------------------------------

  log("Step 3/5 — Creating fresh database with Deno schema");

  // initDb() creates the file, runs all SQL migrations, sets WAL mode.
  // We call it here and then close — main.ts will call initDb() again to get
  // the singleton Client it manages for the rest of the server's lifetime.
  const fresh = await initDb(dbConfig);
  log("         tables: blobs, owners, accessed, media_derivatives");
  log("         owners: composite PRIMARY KEY (blob, pubkey) + ON DELETE CASCADE");

  // ------------------------------------------------------------------
  // Step 4 — Import data
  // ------------------------------------------------------------------

  log("Step 4/5 — Importing data");

  // Strips "; charset=utf-8" and other MIME parameter suffixes.
  // "text/javascript; charset=utf-8" → "text/javascript"
  function normalizeType(raw: string | null): string | null {
    if (!raw) return null;
    const semi = raw.indexOf(";");
    if (semi === -1) return raw;
    const bare = raw.slice(0, semi).trim();
    return bare || null;
  }

  let normalizedCount = 0;
  for (const b of blobs) {
    const normalized = normalizeType(b.type);
    if (normalized !== b.type) normalizedCount++;
    await fresh.execute({
      sql: "INSERT OR IGNORE INTO blobs (sha256, type, size, uploaded) VALUES (?, ?, ?, ?)",
      args: [b.sha256, normalized, b.size, b.uploaded],
    });
  }

  for (const o of owners) {
    await fresh.execute({
      sql: "INSERT OR IGNORE INTO owners (blob, pubkey) VALUES (?, ?)",
      args: [o.blob, o.pubkey],
    });
  }

  for (const a of accessed) {
    await fresh.execute({
      sql: "INSERT OR IGNORE INTO accessed (blob, timestamp) VALUES (?, ?)",
      args: [a.blob, a.timestamp],
    });
  }

  log(`         blobs:    ${blobs.length} imported`);
  if (normalizedCount > 0) {
    log(`         type:     ${normalizedCount} MIME types stripped of charset params`);
  }
  log(`         owners:   ${owners.length} imported`);
  log(`         accessed: ${accessed.length} imported`);

  // ------------------------------------------------------------------
  // Step 5 — Verify row counts
  // ------------------------------------------------------------------

  log("Step 5/5 — Verifying");

  const [vb, vo, va] = await Promise.all([
    fresh.execute("SELECT COUNT(*) FROM blobs"),
    fresh.execute("SELECT COUNT(*) FROM owners"),
    fresh.execute("SELECT COUNT(*) FROM accessed"),
  ]);

  const gotBlobs = vb.rows[0][0] as number;
  const gotOwners = vo.rows[0][0] as number;
  const gotAccessed = va.rows[0][0] as number;

  const ok =
    gotBlobs === blobs.length &&
    gotOwners === owners.length &&
    gotAccessed === accessed.length;

  if (!ok) {
    // Counts don't match — restore backup and abort so the operator can investigate.
    err("FAILED — row count mismatch after import:");
    err(`         blobs:    expected ${blobs.length}, got ${gotBlobs}`);
    err(`         owners:   expected ${owners.length}, got ${gotOwners}`);
    err(`         accessed: expected ${accessed.length}, got ${gotAccessed}`);
    err("Restoring backup and aborting startup.");
    err(`Backup is at: ${backupPath}`);
    fresh.close();
    try {
      await Deno.remove(dbPath);
    } catch { /* ignore */ }
    await Deno.rename(backupPath, dbPath);
    Deno.exit(1);
  }

  // Migration succeeded — close here so main.ts can call initDb() cleanly.
  fresh.close();

  const elapsedMs = Date.now() - startedAt;

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------

  console.log("");
  log("━━━ Migration successful ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log(`  blobs:    ${gotBlobs}  |  owners: ${gotOwners}  |  accessed: ${gotAccessed}`);
  if (normalizedCount > 0) {
    log(`  MIME:     ${normalizedCount} type values normalised (charset params stripped)`);
  }
  if (duplicatesRemoved > 0) {
    log(`  dedup:    ${duplicatesRemoved} duplicate owner rows removed`);
  }
  log(`  elapsed:  ${elapsedMs}ms`);
  log(`  backup:   ${backupPath}`);
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
}
