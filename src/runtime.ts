/**
 * ServerRuntime — live, mutable server state shared by protocol routes, the
 * prune scheduler, and the admin console (main thread only; upload workers
 * never see it).
 */

import type { Client } from "@libsql/client";
import type { Config } from "./config/schema.ts";
import type { IBlobStorage } from "./storage/interface.ts";
import { RuleStore } from "./policy/rule-store.ts";
import { PruneScheduler, type PruneSchedulerOptions } from "./prune/scheduler.ts";
import { ModerationService } from "./moderation/service.ts";
import { createNip05Allowlist, logNip05Results, type Nip05Allowlist, type Nip05RefreshTimers, startNip05Refresh } from "./allowlist/nip05.ts";

export interface ServerRuntime {
  /** Hot-swappable storage rules. */
  rules: RuleStore;
  /** Prune loop. Created stopped; main.ts calls start(). Tests may trigger cycles manually. */
  prune: PruneScheduler;
  /** NIP-05 domain members for rules with nip05Domains. main.ts runs the first fetch and calls startNip05(). */
  nip05: Nip05Allowlist;
  /** Start the periodic NIP-05 refresh (no-op when storage.nip05.refreshIntervalMs is 0). */
  startNip05(options?: { initialDelayMs?: number }): void;
  /** Stop the NIP-05 refresh loop and the rule-change subscription. */
  stopNip05(): void;
  /** Local pubkey and blob bans. Initialized (banned pubkeys loaded into memory). */
  moderation: ModerationService;
}

export interface ServerRuntimeOptions {
  prune?: PruneSchedulerOptions;
  /** Injectable fetch for NIP-05 lookups (tests). */
  nip05Fetch?: typeof fetch;
  /** Injectable timers for the NIP-05 refresh loop (tests). */
  nip05Timers?: Nip05RefreshTimers;
}

export async function createServerRuntime(
  db: Client,
  storage: IBlobStorage,
  config: Config,
  options: ServerRuntimeOptions = {},
): Promise<ServerRuntime> {
  const moderation = new ModerationService(db, storage);
  await moderation.init();

  const rules = new RuleStore(config.storage.rules);
  const nip05 = createNip05Allowlist(rules, { fetchImpl: options.nip05Fetch, timeoutMs: config.storage.nip05.timeoutMs });
  // A domain added through the admin console (or a config reload) is fetched right away instead of after the next interval.
  const unsubscribe = rules.onChange(() => {
    nip05.refreshMissing().then((result) => logNip05Results(result.domains)).catch((err) => console.warn("[nip05] refresh failed:", err));
  });
  let stopRefresh: (() => void) | undefined;
  return {
    rules,
    moderation,
    prune: new PruneScheduler(db, storage, config, rules, options.prune),
    nip05,
    startNip05({ initialDelayMs } = {}) {
      const intervalMs = config.storage.nip05.refreshIntervalMs;
      if (intervalMs > 0 && !stopRefresh) stopRefresh = startNip05Refresh(nip05, intervalMs, { initialDelayMs, timers: options.nip05Timers });
    },
    stopNip05() {
      unsubscribe();
      stopRefresh?.();
    },
  };
}

/** Stop background work owned by the runtime. */
export async function stopServerRuntime(runtime: ServerRuntime): Promise<void> {
  runtime.stopNip05();
  await runtime.prune.stop();
}
