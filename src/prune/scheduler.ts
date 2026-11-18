/**
 * PruneScheduler — owns the recurring prune loop.
 *
 * Always scheduled, because storage rules can be edited at runtime: each cycle
 * reads the current rule snapshot and skips work when there is nothing to do.
 * Prune cursors are indexed by rule position, so they are reset whenever the
 * rule set changes. Uses recursive setTimeout so runs never overlap.
 */

import type { Client } from "@libsql/client";
import type { Config } from "../config/schema.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import type { OperationMetrics } from "../metrics/operations.ts";
import type { PruneMetrics } from "../metrics/prune.ts";
import type { StorageRule } from "../policy/rule-schema.ts";
import type { RuleStore } from "../policy/rule-store.ts";
import { createPruneState, type PruneCandidate, type PruneResult, type PruneState, pruneStorage } from "./prune.ts";

export interface PruneRunSummary extends PruneResult {
  started: number;
  finished: number;
  trigger: "schedule" | "manual";
}

export interface PruneStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  nextRun: number | null;
  lastRun: PruneRunSummary | null;
}

export interface PruneSchedulerOptions {
  metrics?: OperationMetrics;
  pruneMetrics?: PruneMetrics;
  /** Called for every blob deleted by a live (non-dry-run) cycle. */
  onDeleted?: (candidate: PruneCandidate) => void;
  /** Extra bounded work run after each cycle (activity retention, expired bans, ...). */
  housekeeping?: () => Promise<void>;
}

export class PruneScheduler {
  private state: PruneState = createPruneState();
  private running?: Promise<PruneRunSummary>;
  private timer?: ReturnType<typeof setTimeout>;
  private nextRun: number | null = null;
  private lastRun: PruneRunSummary | null = null;
  private stopped = false;
  private unsubscribe: () => void;

  constructor(
    private readonly db: Client,
    private readonly storage: IBlobStorage,
    private readonly config: Config,
    private readonly rules: RuleStore,
    private readonly options: PruneSchedulerOptions = {},
  ) {
    this.unsubscribe = rules.onChange(() => {
      this.state = createPruneState();
      options.pruneMetrics?.setEnabled(this.enabled);
    });
    options.pruneMetrics?.setEnabled(this.enabled);
  }

  /** Whether a cycle currently has any work: rules to evaluate or ownerless cleanup. */
  get enabled(): boolean {
    return this.rules.current().length > 0 || this.config.storage.removeWhenNoOwners;
  }

  start(): void {
    this.schedule(this.config.prune.initialDelayMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe();
    clearTimeout(this.timer);
    this.nextRun = null;
    await this.running?.catch(() => {});
  }

  status(): PruneStatus {
    return {
      enabled: this.enabled,
      running: this.running !== undefined,
      intervalMs: this.config.prune.intervalMs,
      nextRun: this.nextRun,
      lastRun: this.lastRun,
    };
  }

  /** Start a manual cycle now. Returns null when a cycle is already running. */
  trigger(): Promise<PruneRunSummary> | null {
    if (this.running) return null;
    return this.run("manual");
  }

  /**
   * Evaluate a cycle without deleting anything, optionally against proposed rules.
   * Uses fresh cursors, so results are the first batch of candidates per rule — a sample.
   */
  async dryRun(rules: StorageRule[] = this.rules.current()): Promise<PruneCandidate[]> {
    const candidates: PruneCandidate[] = [];
    await pruneStorage(
      this.db,
      this.storage,
      rules,
      this.config.storage.removeWhenNoOwners,
      this.config.prune.batchSize,
      createPruneState(),
      undefined,
      { dryRun: true, onDeleted: (candidate) => candidates.push(candidate) },
    );
    return candidates;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.nextRun = Date.now() + delayMs;
    this.timer = setTimeout(async () => {
      this.nextRun = null;
      if (!this.running) await this.run("schedule").catch(() => {});
      else await this.running.catch(() => {});
      this.schedule(this.config.prune.intervalMs);
    }, delayMs);
  }

  private run(trigger: PruneRunSummary["trigger"]): Promise<PruneRunSummary> {
    const started = Date.now();
    const promise = this.cycle()
      .then((result) => {
        const summary = { ...result, started, finished: Date.now(), trigger };
        this.lastRun = summary;
        return summary;
      })
      .finally(() => {
        this.running = undefined;
      });
    this.running = promise;
    return promise;
  }

  private async cycle(): Promise<PruneResult> {
    let result: PruneResult = { deleted: 0, errors: 0 };
    if (this.enabled) {
      const action = () =>
        pruneStorage(
          this.db,
          this.storage,
          this.rules.current(),
          this.config.storage.removeWhenNoOwners,
          this.config.prune.batchSize,
          this.state,
          this.options.metrics,
          { onDeleted: this.options.onDeleted },
        );
      try {
        result = await (this.options.pruneMetrics ? this.options.pruneMetrics.run(action) : action());
        if (result.deleted > 0 || result.errors > 0) {
          console.log(`[prune] deleted=${result.deleted} errors=${result.errors}`);
        }
      } catch (err) {
        console.error("[prune] Unexpected error in prune loop:", err);
        result = { deleted: 0, errors: 1 };
      }
    }
    try {
      await this.options.housekeeping?.();
    } catch (err) {
      console.error("[prune] Housekeeping failed:", err);
    }
    return result;
  }
}
