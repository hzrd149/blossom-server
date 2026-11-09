/**
 * RuleStore — the live, hot-swappable storage rule snapshot.
 *
 * Protocol routes and the prune scheduler call current() synchronously on every
 * request/cycle. In "config" mode rules come from config.yml and are read-only.
 * In "database" mode they are seeded once from config, then edited through the
 * admin console; each edit writes the database first and then swaps the snapshot.
 */

import type { Client } from "@libsql/client";
import type { Config } from "../config/schema.ts";
import { listStorageRules, replaceStorageRules, seedStorageRulesOnce } from "../db/storage-rules.ts";
import { type ManagedStorageRule, ManagedStorageRulesSchema, type StorageRule, toActiveRules } from "./rule-schema.ts";

export type RulesManagementMode = Config["storage"]["rulesManagement"];

export class RulesNotEditableError extends Error {
  constructor() {
    super('Storage rules are managed in config.yml (storage.rulesManagement is "config")');
    this.name = "RulesNotEditableError";
  }
}

interface Snapshot {
  version: number;
  entries: ManagedStorageRule[];
  active: StorageRule[];
}

export class RuleStore {
  private snapshot: Snapshot;
  private listeners = new Set<(version: number) => void>();

  private constructor(
    readonly mode: RulesManagementMode,
    private readonly db: Client | null,
    private readonly configRules: StorageRule[],
    snapshot: Snapshot,
  ) {
    this.snapshot = snapshot;
  }

  /** Read-only store backed by configuration rules (no database access). */
  static fromConfig(rules: StorageRule[]): RuleStore {
    return new RuleStore("config", null, rules, { version: 0, entries: rules.map((rule) => ({ ...rule })), active: rules });
  }

  static async create(db: Client, config: Config): Promise<RuleStore> {
    const configRules = config.storage.rules;
    if (config.storage.rulesManagement === "config") return RuleStore.fromConfig(configRules);

    if (await seedStorageRulesOnce(db, configRules)) {
      console.log(`[rules] Seeded ${configRules.length} storage rule(s) from config into the database`);
    }
    const store = new RuleStore("database", db, configRules, { version: 0, entries: [], active: [] });
    await store.reload();
    const configDiffers = JSON.stringify(toActiveRules(configRules)) !== JSON.stringify(store.current());
    if (configDiffers) {
      console.warn(
        "[rules] storage.rules in config differs from the database-managed rules; the database rules are in effect " +
          '(storage.rulesManagement is "database"). Use "Reset to config" in the admin console to re-import.',
      );
    }
    return store;
  }

  get editable(): boolean {
    return this.mode === "database";
  }

  get version(): number {
    return this.snapshot.version;
  }

  /** Active (enabled) rules in evaluation order. */
  current(): StorageRule[] {
    return this.snapshot.active;
  }

  /** All rules including disabled ones and editor metadata. */
  entries(): ManagedStorageRule[] {
    return this.snapshot.entries;
  }

  /** Rules from config.yml, for comparison and reset. */
  configured(): StorageRule[] {
    return this.configRules;
  }

  /** Subscribe to snapshot changes; returns an unsubscribe function. */
  onChange(listener: (version: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reload(): Promise<void> {
    if (!this.db) return;
    const stored = await listStorageRules(this.db);
    this.swap(stored.version, stored.rules);
  }

  /**
   * Validate and atomically replace the full ordered list. Throws a ZodError on
   * invalid input, RulesVersionConflict on a stale `expectedVersion`, or
   * RulesNotEditableError in config mode.
   */
  async replace(rules: unknown, expectedVersion?: number): Promise<number> {
    if (!this.db) throw new RulesNotEditableError();
    return await this.write(ManagedStorageRulesSchema.parse(rules), expectedVersion);
  }

  /** Re-import config.yml rules (already validated by the config loader) into the database. */
  async resetToConfig(expectedVersion?: number): Promise<number> {
    if (!this.db) throw new RulesNotEditableError();
    return await this.write(this.configRules.map((rule) => ({ ...rule })), expectedVersion);
  }

  private async write(entries: ManagedStorageRule[], expectedVersion?: number): Promise<number> {
    const version = await replaceStorageRules(this.db!, entries, expectedVersion);
    this.swap(version, entries);
    return version;
  }

  private swap(version: number, entries: ManagedStorageRule[]): void {
    const changed = version !== this.snapshot.version;
    this.snapshot = { version, entries, active: toActiveRules(entries) };
    if (!changed) return;
    for (const listener of this.listeners) {
      try {
        listener(version);
      } catch (err) {
        console.error("[rules] change listener failed:", err);
      }
    }
  }
}
