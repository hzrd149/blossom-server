import type { Client } from "@libsql/client";
import type { OperationMetrics } from "./operations.ts";

const GROUPS = ["image", "video", "audio", "text", "other"];

/** Background-only snapshot. Scrapes read cached values, never the database. */
export class InventoryCollector {
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private db: Pick<Client, "batch">, private metrics: OperationMetrics) {
    metrics.set("blossom_inventory_last_success_timestamp_seconds", "", 0, "Last successful inventory snapshot; zero before first success.");
    metrics.set("blossom_inventory_last_attempt_timestamp_seconds", "", 0, "Last inventory refresh attempt.");
    metrics.set("blossom_inventory_collecting", "", 0, "Whether an inventory refresh is running.");
    metrics.add("blossom_inventory_collection_errors_total", "", 0, "Failed refreshes; previous snapshot is retained.");
  }

  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.running ??= this.collect().finally(() => {
      this.running = undefined;
    });
  }

  start(intervalMs: number): void {
    const run = async () => {
      await this.refresh();
      if (!this.stopped) this.timer = setTimeout(run, intervalMs);
    };
    void run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async collect(): Promise<void> {
    const start = performance.now();
    this.metrics.set("blossom_inventory_collecting", "", 1, "Whether an inventory refresh is running.");
    this.metrics.set("blossom_inventory_last_attempt_timestamp_seconds", "", Date.now() / 1000, "Last inventory refresh attempt.");
    try {
      const [blobs, totals] = await this.db.batch([
        `SELECT CASE
          WHEN lower(type) LIKE 'image/%' THEN 'image'
          WHEN lower(type) LIKE 'video/%' THEN 'video'
          WHEN lower(type) LIKE 'audio/%' THEN 'audio'
          WHEN lower(type) LIKE 'text/%' THEN 'text'
          ELSE 'other' END AS mime_group, COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
          FROM blobs GROUP BY mime_group`,
        "SELECT (SELECT COUNT(*) FROM owners) AS owners, (SELECT COUNT(*) FROM reports) AS reports",
      ], "read");
      const snapshot = GROUPS.map((group) => {
        const row = blobs.rows.find((row) => row.mime_group === group);
        return { group, count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0) };
      });
      const owners = Number(totals.rows[0].owners);
      const reports = Number(totals.rows[0].reports);
      if (![owners, reports, ...snapshot.flatMap((row) => [row.count, row.bytes])].every((value) => Number.isFinite(value) && value >= 0)) {
        throw new Error("Invalid inventory aggregate");
      }
      // Publish synchronously, after every query succeeds.
      for (const row of snapshot) {
        const labels = `mime_group="${row.group}"`;
        this.metrics.set("blossom_inventory_blobs", labels, row.count, "Blob metadata rows, including derivatives.");
        this.metrics.set("blossom_inventory_bytes", labels, row.bytes, "Logical blob bytes; not physical backend usage.");
      }
      this.metrics.set("blossom_inventory_owner_associations", "", owners, "Owner-to-blob associations, not unique users.");
      this.metrics.set("blossom_inventory_reports", "", reports, "Stored reports, not verified findings or pending-only reports.");
      this.metrics.set(
        "blossom_inventory_last_success_timestamp_seconds",
        "",
        Date.now() / 1000,
        "Last successful inventory snapshot; zero before first success.",
      );
    } catch (error) {
      this.metrics.add("blossom_inventory_collection_errors_total", "", 1, "Failed refreshes; previous snapshot is retained.");
      console.warn("[metrics] Inventory refresh failed:", error);
    } finally {
      this.metrics.set("blossom_inventory_collecting", "", 0, "Whether an inventory refresh is running.");
      this.metrics.duration("blossom_inventory_collection_duration_seconds", "", (performance.now() - start) / 1000);
    }
  }
}
