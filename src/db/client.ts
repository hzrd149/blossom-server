import { type Client, createClient } from "@libsql/client";
import { dirname } from "@std/path";

let _client: Client | null = null;

export async function initDb(databasePath: string): Promise<Client> {
  // Ensure the parent directory exists
  const dir = dirname(databasePath);
  await Deno.mkdir(dir, { recursive: true });

  const client = createClient({ url: `file:${databasePath}` });

  // Run initial migration
  const migrationSql = await Deno.readTextFile(
    new URL("./migrations/001_initial.sql", import.meta.url),
  );

  // Execute each statement separately (LibSQL doesn't support multi-statement exec)
  const statements = migrationSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await client.execute(stmt);
  }

  // Enable WAL mode for better concurrent read performance
  await client.execute("PRAGMA journal_mode=WAL");
  await client.execute("PRAGMA synchronous=NORMAL");
  await client.execute("PRAGMA foreign_keys=ON");

  _client = client;
  return client;
}

export function getDb(): Client {
  if (!_client) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _client;
}
