/**
 * RuleStore — the live, hot-swappable storage rule snapshot.
 *
 * Rules always come from config.yml. Protocol routes and the prune scheduler call
 * current() synchronously on every request/cycle. When the admin console writes
 * new rules to config.yml (or reloads a hand-edited file), the re-parsed rules are
 * applied here and take effect immediately, without a restart.
 *
 * Rules with nip05Domains are served with the fetched domain members merged
 * into their pubkeys (see src/allowlist/nip05.ts). Members live only in memory:
 * entries() keeps the rules exactly as written in config.yml.
 */

import { type ConfiguredStorageRule, type StorageRule, toActiveRules } from "./rule-schema.ts";
import { applyNip05Members, nip05DomainsOf, type Nip05Members } from "../allowlist/nip05.ts";

interface Snapshot {
  version: number;
  entries: ConfiguredStorageRule[];
  /** Enabled rules as written, before NIP-05 members are merged in. */
  base: StorageRule[];
  active: StorageRule[];
}

export class RuleStore {
  private snapshot: Snapshot = { version: 0, entries: [], base: [], active: [] };
  private nip05Members: Nip05Members = new Map();
  private listeners = new Set<(version: number) => void>();

  /** @param rules storage.rules from the validated configuration. */
  constructor(rules: readonly ConfiguredStorageRule[] = []) {
    this.snapshot = this.build(0, rules);
  }

  /** Incremented on every apply(); lets the console detect a changed rule set. */
  get version(): number {
    return this.snapshot.version;
  }

  /** Active (enabled) rules in evaluation order. */
  current(): StorageRule[] {
    return this.snapshot.active;
  }

  /** Evaluate a (possibly unsaved) rule list the way current() would serve it: enabled only, NIP-05 members merged. */
  resolve(entries: readonly ConfiguredStorageRule[]): StorageRule[] {
    return applyNip05Members(toActiveRules(entries), this.nip05Members);
  }

  /** Distinct NIP-05 domains referenced by the active rules. */
  nip05Domains(): string[] {
    return nip05DomainsOf(this.snapshot.base);
  }

  /** Replace the fetched NIP-05 members. Re-merges the active rules without bumping the version. */
  setNip05Members(members: Nip05Members): void {
    this.nip05Members = members;
    this.snapshot = { ...this.snapshot, active: applyNip05Members(this.snapshot.base, members) };
  }

  /** All rules including disabled ones and editor metadata, as written in config.yml. */
  entries(): ConfiguredStorageRule[] {
    return this.snapshot.entries;
  }

  /** Subscribe to snapshot changes; returns an unsubscribe function. */
  onChange(listener: (version: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Swap in a new rule list (already validated as configuration, e.g. re-read from
   * config.yml) and notify listeners. Returns the new version.
   */
  apply(rules: readonly ConfiguredStorageRule[]): number {
    this.snapshot = this.build(this.snapshot.version + 1, rules);
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot.version);
      } catch (err) {
        console.error("[rules] change listener failed:", err);
      }
    }
    return this.snapshot.version;
  }

  private build(version: number, rules: readonly ConfiguredStorageRule[]): Snapshot {
    const entries = rules.map((rule) => ({ ...rule }));
    const base = toActiveRules(entries);
    return { version, entries, base, active: applyNip05Members(base, this.nip05Members) };
  }
}
