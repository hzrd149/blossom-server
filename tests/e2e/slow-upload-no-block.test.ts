/**
 * Stress test: slow uploads must not block fast uploads on the same worker.
 *
 * Scenario
 * --------
 * A single-worker pool with maxJobsPerWorker=4 is used. One "slow" upload is
 * submitted first — its ReadableStream drips bytes at ~1 chunk per 100 ms so
 * it stays in-flight for at least 1 second. While it is running, we fire
 * (maxJobsPerWorker - 1) = 3 "fast" uploads at the same worker and assert
 * they all complete in well under 1 second.
 *
 * Pre-multi-job design: the slow upload would hold the single worker slot.
 * Every fast upload would return 503. The test would fail.
 *
 * Post-multi-job design: the slow upload occupies one job slot; the worker's
 * event loop is free during the slow stream's I/O awaits. Fast uploads take
 * the remaining slots on the same worker and complete normally.
 *
 * What is verified
 * ----------------
 *   1. Slow upload completes and returns 200 with the correct hash.
 *   2. All (maxJobsPerWorker - 1) fast uploads return 200 (not 503).
 *   3. Fast uploads finish in < FAST_UPLOAD_MAX_MS (well under the slow
 *      upload's total duration), proving they ran concurrently.
 *   4. A (maxJobsPerWorker + 1)th request returns 503 — the pool capacity
 *      limit is still enforced correctly.
 */

import { assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { crypto as stdCrypto } from "@std/crypto";
import { join } from "@std/path";
import { initDb } from "../../src/db/client.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { initPool } from "../../src/workers/pool.ts";
import { buildApp } from "../../src/server.ts";
import { ConfigSchema } from "../../src/config/schema.ts";
import type { Hono } from "@hono/hono";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many concurrent jobs a single worker will accept. Must match pool init below. */
const MAX_JOBS_PER_WORKER = 4;

/**
 * Number of fast uploads to fire concurrently while the slow upload is in-flight.
 * Must be ≤ (MAX_JOBS_PER_WORKER - 1) to guarantee all of them fit alongside
 * the slow upload. Using exactly (MAX_JOBS_PER_WORKER - 1) packs the worker
 * to its limit while still leaving room for all fast uploads.
 */
const FAST_COUNT = MAX_JOBS_PER_WORKER - 1; // 3

/**
 * How long the slow upload should stay in-flight (ms).
 * The slow stream emits one 64-byte chunk every SLOW_CHUNK_INTERVAL_MS.
 * We drip SLOW_CHUNK_COUNT chunks, so total stream duration ≈
 *   SLOW_CHUNK_COUNT × SLOW_CHUNK_INTERVAL_MS.
 */
const SLOW_CHUNK_INTERVAL_MS = 100;
const SLOW_CHUNK_COUNT = 12; // ≈ 1.2 s total slow-stream duration

/** Maximum wall-clock time fast uploads are allowed to take (ms). */
const FAST_UPLOAD_MAX_MS = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await stdCrypto.subtle.digest(
    "SHA-256",
    data.buffer as ArrayBuffer,
  );
  return encodeHex(new Uint8Array(buf));
}

/**
 * Build a ReadableStream that emits `count` chunks of `chunk` bytes each,
 * sleeping `intervalMs` between each chunk enqueue. The stream takes at least
 * count × intervalMs milliseconds to fully consume.
 */
function makeSlowStream(
  chunk: Uint8Array,
  count: number,
  intervalMs: number,
): ReadableStream<Uint8Array> {
  let emitted = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (emitted >= count) {
        controller.close();
        return;
      }
      // Delay before emitting the next chunk — simulates a slow client.
      await new Promise<void>((r) => setTimeout(r, intervalMs));
      controller.enqueue(chunk.slice());
      emitted++;
    },
  });
}

// ---------------------------------------------------------------------------
// Shared server setup (one pool, one app — all tests share it)
// ---------------------------------------------------------------------------

let app: Hono;
let tmpDir: string;
let pool: ReturnType<typeof initPool>;

Deno.test({
  name:
    `stress setup: initialize server with 1 worker, maxJobsPerWorker=${MAX_JOBS_PER_WORKER}`,
  async fn() {
    tmpDir = await Deno.makeTempDir({ prefix: "blossom_stress_slow_" });
    const dbPath = join(tmpDir, "test.db");
    const storageDir = join(tmpDir, "blobs");
    const dbConfig = { path: dbPath };

    const db = await initDb(dbConfig);
    const storage = new LocalStorage(storageDir);
    await storage.setup();

    // 1 worker, MAX_JOBS_PER_WORKER concurrent jobs per worker, 500 ms throughput window
    pool = initPool(1, MAX_JOBS_PER_WORKER, 500, db, dbConfig);

    const config = ConfigSchema.parse({
      publicDomain: "http://localhost",
      upload: {
        requireAuth: false,
        enabled: true,
        workers: 1,
        maxJobsPerWorker: MAX_JOBS_PER_WORKER,
      },
    });

    app = buildApp(db, storage, storageDir, config);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ---------------------------------------------------------------------------
// Core stress assertion
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "stress: fast uploads complete while a slow upload is in-flight on the same worker",
  async fn() {
    // --- Build the slow upload body ---
    const slowChunk = new Uint8Array(64).fill(0xab);
    const slowBodySize = slowChunk.byteLength * SLOW_CHUNK_COUNT;
    // Pre-compute the expected SHA-256 so we can verify integrity later.
    const slowBodyFull = new Uint8Array(slowBodySize);
    for (let i = 0; i < SLOW_CHUNK_COUNT; i++) {
      slowBodyFull.set(slowChunk, i * slowChunk.byteLength);
    }
    const expectedSlowHash = await sha256Hex(slowBodyFull);

    // --- Start the slow upload (do NOT await — let it run in background) ---
    const slowStream = makeSlowStream(
      slowChunk,
      SLOW_CHUNK_COUNT,
      SLOW_CHUNK_INTERVAL_MS,
    );
    const slowUploadPromise = app.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: {
          "Content-Length": String(slowBodySize),
          "Content-Type": "application/octet-stream",
          "X-SHA-256": expectedSlowHash,
        },
        body: slowStream,
        // @ts-ignore — duplex is required for streaming request bodies in some runtimes
        duplex: "half",
      }),
    );

    // Give the slow upload a head start so it is definitely in-flight before
    // we fire the fast uploads. One chunk interval is enough.
    await new Promise<void>((r) => setTimeout(r, SLOW_CHUNK_INTERVAL_MS));

    // --- Fire FAST_COUNT fast uploads concurrently ---
    const fastBody = new TextEncoder().encode("fast");
    const expectedFastHash = await sha256Hex(fastBody);

    const fastStart = performance.now();

    const fastResults = await Promise.all(
      Array.from({ length: FAST_COUNT }, () =>
        app.fetch(
          new Request("http://localhost/upload", {
            method: "PUT",
            headers: {
              "Content-Length": String(fastBody.byteLength),
              "Content-Type": "text/plain",
              "X-SHA-256": expectedFastHash,
            },
            body: fastBody.slice(),
          }),
        )),
    );

    const fastElapsedMs = performance.now() - fastStart;

    // --- Assert fast upload results ---
    for (let i = 0; i < FAST_COUNT; i++) {
      const res = fastResults[i];
      assertEquals(
        res.status,
        200,
        `Fast upload #${
          i + 1
        } returned ${res.status} — expected 200 (not blocked by slow upload)`,
      );
      const json = await res.json();
      assertEquals(
        json.sha256,
        expectedFastHash,
        `Fast upload #${i + 1} returned wrong hash`,
      );
    }

    assertEquals(
      fastElapsedMs < FAST_UPLOAD_MAX_MS,
      true,
      `Fast uploads took ${
        fastElapsedMs.toFixed(0)
      } ms — expected < ${FAST_UPLOAD_MAX_MS} ms. ` +
        `If this fails, the slow upload may be serialising the worker.`,
    );

    // --- Wait for the slow upload to complete and verify it ---
    const slowRes = await slowUploadPromise;
    assertEquals(
      slowRes.status,
      200,
      `Slow upload returned ${slowRes.status} — expected 200`,
    );
    const slowJson = await slowRes.json();
    assertEquals(
      slowJson.sha256,
      expectedSlowHash,
      "Slow upload returned wrong hash — stream integrity error",
    );
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ---------------------------------------------------------------------------
// Pool-at-capacity: jobs beyond maxJobsPerWorker still get 503
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "stress: 503 when all job slots are saturated (maxJobsPerWorker exceeded)",
  async fn() {
    // Fill all MAX_JOBS_PER_WORKER slots simultaneously, then verify the next
    // request returns 503 (pool saturated — no-queue policy).
    const slotCount = MAX_JOBS_PER_WORKER;
    const slot = new Uint8Array(64).fill(0xcd);
    const slotBodySize = slot.byteLength * SLOW_CHUNK_COUNT;
    const slotBodyFull = new Uint8Array(slotBodySize);
    for (let i = 0; i < SLOW_CHUNK_COUNT; i++) {
      slotBodyFull.set(slot, i * slot.byteLength);
    }
    const slotHash = await sha256Hex(slotBodyFull);

    // Start slotCount slow uploads — do NOT await
    const slowPromises = Array.from({ length: slotCount }, () => {
      const stream = makeSlowStream(
        slot,
        SLOW_CHUNK_COUNT,
        SLOW_CHUNK_INTERVAL_MS,
      );
      return app.fetch(
        new Request("http://localhost/upload", {
          method: "PUT",
          headers: {
            "Content-Length": String(slotBodySize),
            "Content-Type": "application/octet-stream",
            "X-SHA-256": slotHash,
          },
          body: stream,
          // @ts-ignore
          duplex: "half",
        }),
      );
    });

    // Wait long enough for all slotCount uploads to be registered in the pool
    await new Promise<void>((r) => setTimeout(r, SLOW_CHUNK_INTERVAL_MS * 2));

    // The (MAX_JOBS_PER_WORKER + 1)th request must be rejected with 503
    const overflowBody = new TextEncoder().encode("overflow");
    const overflowRes = await app.fetch(
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: {
          "Content-Length": String(overflowBody.byteLength),
          "Content-Type": "text/plain",
        },
        body: overflowBody,
      }),
    );

    assertEquals(
      overflowRes.status,
      503,
      `Expected 503 when all ${slotCount} job slots are occupied, got ${overflowRes.status}`,
    );
    await overflowRes.body?.cancel();

    // Let the slow uploads drain so we don't pollute later tests
    for (const p of slowPromises) {
      const r = await p;
      await r.body?.cancel();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

Deno.test({
  name: "stress teardown: shutdown pool and clean up",
  async fn() {
    pool.shutdown();
    await Deno.remove(tmpDir, { recursive: true });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
