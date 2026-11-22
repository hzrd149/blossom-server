import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createClient } from "@libsql/client";
import { OperationMetrics } from "../../src/metrics/operations.ts";
import { InventoryCollector } from "../../src/metrics/inventory.ts";
import { PruneMetrics } from "../../src/metrics/prune.ts";
import { UploadWorkerPool } from "../../src/workers/pool.ts";
import { pruneStorage } from "../../src/prune/prune.ts";
import { LocalStorage } from "../../src/storage/local.ts";

Deno.test("inventory snapshot is bounded, cached, refreshed atomically and retained on failure", async () => {
  const db = createClient({ url: ":memory:" });
  const metrics = new OperationMetrics();
  let calls = 0;
  let fail = false;
  const collector = new InventoryCollector({
    batch: (...args) => {
      calls++;
      if (fail) return Promise.reject(new Error("unavailable"));
      return db.batch(...args);
    },
  }, metrics);
  try {
    await db.batch([
      "CREATE TABLE blobs (size INTEGER, type TEXT)",
      "CREATE TABLE owners (blob TEXT)",
      "CREATE TABLE reports (id TEXT)",
      "INSERT INTO blobs VALUES (10, 'image/png'), (20, 'VIDEO/mp4'), (3, NULL), (4, 'private/arbitrary')",
      "INSERT INTO owners VALUES ('a'), ('a')",
      "INSERT INTO reports VALUES ('r')",
    ]);
    const first = collector.refresh();
    assertEquals(collector.refresh(), first);
    await first;
    assertEquals(calls, 1);
    const text = metrics.render();
    assertStringIncludes(text, 'blossom_inventory_bytes{mime_group="other"} 7');
    assertStringIncludes(text, 'blossom_inventory_bytes{mime_group="video"} 20');
    assertStringIncludes(text, "blossom_inventory_owner_associations 2");
    assertEquals(text.includes("private/arbitrary"), false);
    metrics.render();
    assertEquals(calls, 1);
    await db.execute("DELETE FROM blobs");
    fail = true;
    await collector.refresh();
    assertStringIncludes(metrics.render(), 'blossom_inventory_bytes{mime_group="video"} 20');
    assertStringIncludes(metrics.render(), "blossom_inventory_collection_errors_total 1");
    fail = false;
    await collector.refresh();
    assertStringIncludes(metrics.render(), 'blossom_inventory_bytes{mime_group="video"} 0');
    await collector.stop();
    await collector.refresh();
    assertEquals(calls, 3);
  } finally {
    await collector.stop();
    db.close();
  }
});

Deno.test("prune query failures count as failed cycles and preserve last-success timestamp", async () => {
  const db = createClient({ url: ":memory:" });
  const metrics = new OperationMetrics();
  const prune = new PruneMetrics(metrics, true);
  try {
    // Missing tables simulate database query failures in both rule sources and ownerless scan.
    const result = await prune.run(() => pruneStorage(db, new LocalStorage("/unused"), [{ type: "*", expiration: "1 day" }], true));
    assertEquals(result.errors, 3);
    assertStringIncludes(metrics.render(), "blossom_prune_last_success_timestamp_seconds 0");
    await prune.run(() => Promise.resolve({ deleted: 2, errors: 0 }));
    const lastSuccess = metrics.render().split("\n").find((line) => line.startsWith("blossom_prune_last_success_timestamp_seconds "));
    await assertRejects(() => prune.run(() => Promise.reject(new Error("failure"))));
    assertEquals(metrics.render().split("\n").find((line) => line.startsWith("blossom_prune_last_success_timestamp_seconds ")), lastSuccess);
    assertStringIncludes(metrics.render(), "blossom_prune_running 0");
    assertStringIncludes(metrics.render(), "blossom_prune_errors_total 4");
    assertStringIncludes(metrics.render(), "blossom_prune_deleted_blobs_total 2");
  } finally {
    db.close();
  }
});

Deno.test("worker metrics settle success, rejection, dispatch failure, crash and shutdown", async () => {
  const OriginalWorker = globalThis.Worker;
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { message: string; preventDefault(): void }) => void;
    jobs: string[] = [];
    fail = false;
    constructor() {
      workers.push(this);
    }
    postMessage(message: { type: string; id: string }) {
      if (this.fail) throw new Error("transfer failed");
      if (message.type === "job") this.jobs.push(message.id);
    }
    terminate() {}
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const db = createClient({ url: ":memory:" });
  const metrics = new OperationMetrics();
  const pool = new UploadWorkerPool(1, 1, 1000, db, { path: ":memory:", url: "http://localhost" }, metrics);
  const dispatch = () =>
    pool.dispatch(
      new ReadableStream({
        start(c) {
          c.close();
        },
      }),
      "/unused",
      null,
      null,
    );
  try {
    const job = dispatch()!;
    assertEquals(dispatch(), null);
    assertStringIncludes(metrics.render(), "blossom_worker_jobs_active 1");
    workers[0].onmessage!({ data: { id: workers[0].jobs[0], hash: "hash", size: 3 } });
    await job;
    workers[0].fail = true;
    await assertRejects(() => dispatch()!);
    workers[0].fail = false;
    const crashed = dispatch()!;
    const rejection = assertRejects(() => crashed);
    workers[0].onerror!({ message: "crash", preventDefault() {} });
    await rejection;
    assertStringIncludes(metrics.render(), "blossom_worker_jobs_capacity 0");
    assertStringIncludes(metrics.render(), "blossom_worker_jobs_active 0");
    assertStringIncludes(metrics.render(), 'blossom_worker_jobs_total{outcome="dispatch_error"} 1');
    assertStringIncludes(metrics.render(), "blossom_worker_crashes_total 1");
    const second = new UploadWorkerPool(1, 1, 1000, db, { path: ":memory:", url: "http://localhost" }, new OperationMetrics());
    const pending = second.dispatch(new ReadableStream(), "/unused", null, null)!;
    const shutdownRejection = assertRejects(() => pending);
    second.shutdown();
    await shutdownRejection;
  } finally {
    pool.shutdown();
    globalThis.Worker = OriginalWorker;
    db.close();
  }
});
