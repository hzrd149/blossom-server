import { createClient } from "@libsql/client";
import { type DbConfig, initDb } from "./client.ts";

const encoder = new TextEncoder();

function writeLine(message = ""): void {
  Deno.stdout.writeSync(encoder.encode(`${message}\n`));
}

function writeErrorLine(message: string): void {
  Deno.stderr.writeSync(encoder.encode(`${message}\n`));
}

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

  const isLegacy = await detectLegacySchema(dbPath);
  if (!isLegacy) return;

  await runMigration(dbPath, dbConfig);
}

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

async function runMigration(dbPath: string, dbConfig: DbConfig): Promise<void> {
  const backupPath = `${dbPath}.bak`;
  const startedAt = Date.now();

  const log = (msg: string) => writeLine(`  [legacy-migration] ${msg}`);
  const err = (msg: string) => writeErrorLine(`  [legacy-migration] ${msg}`);

  writeLine();
  log("━━━ Legacy Node.js database detected ━━━");
  log(`Source:  ${dbPath}`);
  log(`Backup:  ${backupPath}`);
  writeLine();

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

  log("Step 2/5 — Backing up legacy database");
  await Deno.rename(dbPath, backupPath);
  log(`         sqlite.db → sqlite.db.bak`);

  log("Step 3/5 — Creating fresh database with Deno schema");

  // initDb() creates the file, runs all SQL migrations, sets WAL mode.
  // We call it here and then close — main.ts will call initDb() again to get
  // the singleton Client it manages for the rest of the server's lifetime.
  const fresh = await initDb(dbConfig);
  log("         tables: blobs, owners, accessed, media_derivatives");
  log(
    "         owners: composite PRIMARY KEY (blob, pubkey) + ON DELETE CASCADE",
  );

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
    log(
      `         type:     ${normalizedCount} MIME types stripped of charset params`,
    );
  }
  log(`         owners:   ${owners.length} imported`);
  log(`         accessed: ${accessed.length} imported`);

  log("Step 5/5 — Verifying");

  const [vb, vo, va] = await Promise.all([
    fresh.execute("SELECT COUNT(*) FROM blobs"),
    fresh.execute("SELECT COUNT(*) FROM owners"),
    fresh.execute("SELECT COUNT(*) FROM accessed"),
  ]);

  const gotBlobs = vb.rows[0][0] as number;
  const gotOwners = vo.rows[0][0] as number;
  const gotAccessed = va.rows[0][0] as number;

  const ok = gotBlobs === blobs.length &&
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

  fresh.close();

  const elapsedMs = Date.now() - startedAt;

  writeLine();
  log("━━━ Migration successful ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log(
    `  blobs:    ${gotBlobs}  |  owners: ${gotOwners}  |  accessed: ${gotAccessed}`,
  );
  if (normalizedCount > 0) {
    log(
      `  MIME:     ${normalizedCount} type values normalised (charset params stripped)`,
    );
  }
  if (duplicatesRemoved > 0) {
    log(`  dedup:    ${duplicatesRemoved} duplicate owner rows removed`);
  }
  log(`  elapsed:  ${elapsedMs}ms`);
  log(`  backup:   ${backupPath}`);
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  writeLine();
}
