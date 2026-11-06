import type { PruneResult } from "../prune/prune.ts";
import type { OperationMetrics } from "./operations.ts";

export class PruneMetrics {
  constructor(private metrics: OperationMetrics, enabled: boolean) {
    metrics.set("blossom_prune_enabled", "", Number(enabled), "Whether scheduled pruning is configured.");
    metrics.set("blossom_prune_running", "", 0, "Whether a scheduled prune cycle is running.");
    metrics.set("blossom_prune_last_attempt_timestamp_seconds", "", 0, "Last scheduled prune attempt; zero before first attempt.");
    metrics.set("blossom_prune_last_success_timestamp_seconds", "", 0, "Last error-free scheduled prune cycle; zero before first success.");
    metrics.add("blossom_prune_errors_total", "", 0, "Query, validation, deletion, and unexpected cycle errors.");
    metrics.add("blossom_prune_deleted_blobs_total", "", 0, "Blobs whose prune deletion completed, including already absent objects.");
    metrics.add("blossom_prune_deleted_bytes_total", "", 0, "Logical bytes removed by pruning; not physical backend usage.");
  }

  async run(action: () => Promise<PruneResult>): Promise<PruneResult> {
    const start = performance.now();
    this.metrics.set("blossom_prune_running", "", 1, "Whether a scheduled prune cycle is running.");
    this.metrics.set("blossom_prune_last_attempt_timestamp_seconds", "", Date.now() / 1000, "Last scheduled prune attempt; zero before first attempt.");
    let outcome = "error";
    try {
      const result = await action();
      this.metrics.add("blossom_prune_errors_total", "", result.errors, "Query, validation, deletion, and unexpected cycle errors.");
      this.metrics.add("blossom_prune_deleted_blobs_total", "", result.deleted, "Blobs whose prune deletion completed, including already absent objects.");
      if (result.errors === 0) {
        outcome = "success";
        this.metrics.set(
          "blossom_prune_last_success_timestamp_seconds",
          "",
          Date.now() / 1000,
          "Last error-free scheduled prune cycle; zero before first success.",
        );
      }
      return result;
    } catch (error) {
      this.metrics.add("blossom_prune_errors_total", "", 1, "Query, validation, deletion, and unexpected cycle errors.");
      throw error;
    } finally {
      this.metrics.set("blossom_prune_running", "", 0, "Whether a scheduled prune cycle is running.");
      this.metrics.add("blossom_prune_cycles_total", `outcome="${outcome}"`, 1, "Finished scheduled prune cycles.");
      this.metrics.duration("blossom_prune_duration_seconds", `outcome="${outcome}"`, (performance.now() - start) / 1000);
    }
  }
}
