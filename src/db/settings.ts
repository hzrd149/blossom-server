import type { Client, Transaction } from "@libsql/client";

type Executor = Pick<Client | Transaction, "execute">;

export async function getSetting(db: Executor, key: string): Promise<string | null> {
  const rs = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  return (rs.rows[0]?.[0] as string | undefined) ?? null;
}

export async function setSetting(db: Executor, key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated) VALUES (?, ?, ?)
          ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated = excluded.updated`,
    args: [key, value, Math.floor(Date.now() / 1000)],
  });
}

/** Read an integer counter setting, defaulting to 0. */
export async function getVersion(db: Executor, key: string): Promise<number> {
  const value = Number(await getSetting(db, key));
  return Number.isSafeInteger(value) ? value : 0;
}

/** Increment an integer counter setting and return the new value. */
export async function bumpVersion(db: Executor, key: string): Promise<number> {
  const next = (await getVersion(db, key)) + 1;
  await setSetting(db, key, String(next));
  return next;
}
