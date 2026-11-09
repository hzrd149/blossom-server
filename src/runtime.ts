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

export interface ServerRuntime {
  /** Hot-swappable storage rules. */
  rules: RuleStore;
  /** Prune loop. Created stopped; main.ts calls start(). Tests may trigger cycles manually. */
  prune: PruneScheduler;
}

export interface ServerRuntimeOptions {
  prune?: PruneSchedulerOptions;
}

export async function createServerRuntime(
  db: Client,
  storage: IBlobStorage,
  config: Config,
  options: ServerRuntimeOptions = {},
): Promise<ServerRuntime> {
  const rules = await RuleStore.create(db, config);
  return { rules, prune: new PruneScheduler(db, storage, config, rules, options.prune) };
}

/** Stop background work owned by the runtime. */
export async function stopServerRuntime(runtime: ServerRuntime): Promise<void> {
  await runtime.prune.stop();
}
