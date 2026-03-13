import { type Client, createClient } from "@libsql/client";
import { dirname, join } from "@std/path";

let _client: Client | null = null;

export interface DbConfig {
  // Local SQLite path. Used when url is not set.
  path: string;
  // Remote libSQL / Turso URL. When present, path is ignored.
  url?: string;
  // Auth token for remote libSQL / Turso. Not required for local sqld.
  authToken?: string;
}

/** Returns true when the config points at a remote (non-file:) libSQL server. */
export function isRemoteDb(config: DbConfig): boolean {
  return config.url !== undefined;
}

export async function initDb(config: DbConfig): Promise<Client> {
  const remote = isRemoteDb(config);
  let client: Client;

  if (remote) {
    client = createClient({ url: config.url!, authToken: config.authToken });
  } else {
    // Ensure the parent directory exists for local SQLite
    const dir = dirname(config.path);
    await Deno.mkdir(dir, { recursive: true });
    client = createClient({ url: `file:${config.path}` });
  }

  // Run all migrations in alphabetical (numeric) order.
  // All statements use CREATE TABLE IF NOT EXISTS — safe to re-run at startup.
  const migrationsDir = new URL("./migrations/", import.meta.url);
  const entries: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      entries.push(entry.name);
    }
  }
  entries.sort();

  for (const name of entries) {
    const sql = await Deno.readTextFile(
      new URL(join("./migrations/", name), import.meta.url),
    );
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await client.execute(stmt);
    }
  }

  // WAL mode and related pragmas are SQLite-only — skip for remote libSQL
  if (!remote) {
    await client.execute("PRAGMA journal_mode=WAL");
    await client.execute("PRAGMA synchronous=NORMAL");
    await client.execute("PRAGMA foreign_keys=ON");
  }

  _client = client;
  return client;
}

export function getDb(): Client {
  if (!_client) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _client;
}
