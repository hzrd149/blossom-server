import type { Client } from "@libsql/client";
import type { ManagedStorageRule } from "../policy/rule-schema.ts";
import { bumpVersion, getSetting, getVersion, setSetting } from "./settings.ts";

export const RULES_VERSION_KEY = "storage_rules.version";
export const RULES_SEEDED_KEY = "storage_rules.seeded";

export interface StoredRules {
  version: number;
  rules: ManagedStorageRule[];
}

function parsePubkeys(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((pk): pk is string => typeof pk === "string") : undefined;
  } catch {
    return undefined;
  }
}

export async function listStorageRules(db: Pick<Client, "execute">): Promise<StoredRules> {
  const [rs, version] = await Promise.all([
    db.execute("SELECT type, expiration, basis, pubkeys, enabled, note FROM storage_rules ORDER BY position ASC, id ASC"),
    getVersion(db, RULES_VERSION_KEY),
  ]);
  return {
    version,
    rules: rs.rows.map((row) => ({
      type: row[0] as string,
      expiration: row[1] as string,
      ...(row[2] ? { basis: row[2] as "accessed" | "uploaded" } : {}),
      ...(parsePubkeys(row[3]) ? { pubkeys: parsePubkeys(row[3]) } : {}),
      enabled: Boolean(row[4]),
      ...(row[5] ? { note: row[5] as string } : {}),
    })),
  };
}

export class RulesVersionConflict extends Error {
  constructor(public readonly current: number) {
    super(`Storage rules changed (current version ${current})`);
    this.name = "RulesVersionConflict";
  }
}

/**
 * Atomically replace the ordered rule list. When `expectedVersion` is given and
 * does not match the stored version, nothing is written and RulesVersionConflict
 * is thrown. Returns the new version.
 */
export async function replaceStorageRules(
  db: Client,
  rules: ManagedStorageRule[],
  expectedVersion?: number,
): Promise<number> {
  const tx = await db.transaction("write");
  try {
    const current = await getVersion(tx, RULES_VERSION_KEY);
    if (expectedVersion !== undefined && expectedVersion !== current) throw new RulesVersionConflict(current);
    const now = Math.floor(Date.now() / 1000);
    await tx.execute("DELETE FROM storage_rules");
    for (const [position, rule] of rules.entries()) {
      await tx.execute({
        sql: `INSERT INTO storage_rules (position, type, expiration, basis, pubkeys, enabled, note, created, updated)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          position,
          rule.type,
          rule.expiration,
          rule.basis ?? null,
          rule.pubkeys ? JSON.stringify(rule.pubkeys) : null,
          rule.enabled === false ? 0 : 1,
          rule.note ?? null,
          now,
          now,
        ],
      });
    }
    const version = await bumpVersion(tx, RULES_VERSION_KEY);
    await tx.commit();
    return version;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  } finally {
    tx.close();
  }
}

/** Copy configuration rules into the table the first time database mode starts. Returns true if seeded now. */
export async function seedStorageRulesOnce(db: Client, rules: ManagedStorageRule[]): Promise<boolean> {
  if (await getSetting(db, RULES_SEEDED_KEY)) return false;
  await replaceStorageRules(db, rules);
  await setSetting(db, RULES_SEEDED_KEY, "1");
  return true;
}
