#!/usr/bin/env deno

/**
 * Blossom Server — Deno entry point.
 *
 * Startup order:
 *   1. Load + validate config (YAML + env vars)
 *   2. Init database (LibSQL embedded, run migrations)
 *   3. Init storage adapter (local filesystem or S3)
 *   4. Init hash worker pool (pre-warm N workers)
 *   5. Build Hono app
 *   6. Start Deno.serve()
 */

import { loadConfig } from "./src/config/loader.ts";
import { type DbConfig, initDb } from "./src/db/client.ts";
import { maybeMigrateLegacyDb } from "./src/db/legacy-migration.ts";
import type { IBlobStorage } from "./src/storage/interface.ts";
import { LocalStorage } from "./src/storage/local.ts";
import { S3Storage } from "./src/storage/s3.ts";
import { initPool } from "./src/workers/pool.ts";
import { buildApp } from "./src/server.ts";
import { createServerRuntime, stopServerRuntime } from "./src/runtime.ts";
import { HttpMetrics } from "./src/metrics/http.ts";
import { instrumentStorage } from "./src/metrics/storage.ts";
import { InventoryCollector } from "./src/metrics/inventory.ts";
import { PruneMetrics } from "./src/metrics/prune.ts";
import packageInfo from "./deno.json" with { type: "json" };

const configPath = Deno.args[0] ?? "config.yml";
const config = await loadConfig(configPath);
const metrics = config.metrics.enabled ? new HttpMetrics(packageInfo.version) : undefined;

// Config schema resolves deprecated databasePath into config.database automatically.
const dbConfig: DbConfig = config.database;
const dbLabel = dbConfig.url ?? `file:${dbConfig.path}`;

console.log("Blossom Server starting...");
console.log(`  Config:   ${configPath}`);
console.log(`  Database: ${dbLabel}`);
console.log(`  Storage:  ${config.storage.backend}`);
console.log(`  Host:     ${config.host}`);
console.log(`  Port:     ${config.port}`);

// Migrate legacy Node.js database if present (no-op for remote or already-migrated DBs).
// Must run before initDb() opens the file. See src/db/legacy-migration.ts for details.
if (!dbConfig.url) {
  await maybeMigrateLegacyDb(dbConfig.path, dbConfig);
}

// Init database
const db = await initDb(dbConfig);
console.log("  Database: ready");

// Init storage
let storage: IBlobStorage;
if (config.storage.backend === "local") {
  const storageDir = config.storage.local?.dir ?? "./data/blobs";
  const local = new LocalStorage(storageDir);
  await local.setup();
  storage = local;
  console.log(`  Storage:  local (${storageDir})`);
} else {
  const s3Config = config.storage.s3;
  if (!s3Config) {
    console.error(
      "S3 storage backend selected but no [storage.s3] config section found.",
    );
    Deno.exit(1);
  }
  const s3 = new S3Storage({
    endpoint: s3Config.endpoint,
    bucket: s3Config.bucket,
    accessKey: s3Config.accessKey,
    secretKey: s3Config.secretKey,
    region: s3Config.region,
    publicURL: s3Config.publicURL,
    tmpDir: s3Config.tmpDir,
    onReadError: (operation, missing) =>
      metrics?.operations.add(
        "blossom_s3_caught_errors_total",
        `operation="${operation}",reason="${missing ? "not_found" : "backend_error"}"`,
        1,
        "S3 errors caught by the adapter, including internal dedup checks.",
      ),
  });
  console.log(
    `  Storage:  s3 — verifying bucket access (${s3Config.bucket} @ ${s3Config.endpoint})...`,
  );
  await s3.setup();
  storage = s3;
  console.log(
    `  Storage:  s3 ready (bucket=${s3Config.bucket} endpoint=${s3Config.endpoint})`,
  );
}

if (metrics) storage = instrumentStorage(storage, metrics.operations, config.storage.backend);

// Init upload worker pool — dbConfig determines whether workers use MessageChannel
// (local SQLite) or open their own direct connections (remote libSQL / Turso).
const pool = initPool(
  config.upload.workers,
  config.upload.maxJobsPerWorker,
  config.upload.throughputWindowMs,
  db,
  dbConfig,
  metrics?.operations,
);
console.log(`  Workers:  ${pool.size} upload workers`);

// Resolve admin dashboard password (auto-generate if blank).
// The password is used directly by Hono's basicAuth middleware in the admin router.
if (config.dashboard.enabled) {
  if (!config.dashboard.password) {
    // Generate a random 20-char alphanumeric password and patch config in memory
    const bytes = new Uint8Array(15);
    crypto.getRandomValues(bytes);
    const generated = btoa(String.fromCharCode(...bytes))
      .replace(/[+/=]/g, "")
      .slice(0, 20);
    config.dashboard.password = generated;
    console.log(`  Admin:    password auto-generated: ${generated}`);
  }
  console.log("  Admin:    ready");
}

// Live server state: hot-swappable storage rules and the prune scheduler.
const pruneMetrics = metrics ? new PruneMetrics(metrics.operations, false) : undefined;
const runtime = await createServerRuntime(db, storage, config, {
  prune: { metrics: metrics?.operations, pruneMetrics },
});

// NIP-05 domain allowlists: rules with nip05Domains get the pubkeys published in
// each domain's /.well-known/nostr.json merged into their pubkeys. The first fetch
// happens before the app is built so members can upload from the first request;
// a failed fetch is logged but never aborts startup.
const nip05Failed: string[] = [];
for (const result of (await runtime.nip05.refresh()).domains) {
  if (result.error) {
    nip05Failed.push(result.domain);
    console.warn(`  NIP-05:   ${result.domain}: fetch failed (${result.error}) — no pubkeys until a refresh succeeds`);
  } else {
    console.log(`  NIP-05:   ${result.domain}: ${result.count} pubkeys`);
  }
}
const nip05IntervalMs = config.storage.nip05.refreshIntervalMs;
const nip05RetryMs = Math.min(30_000, nip05IntervalMs);
if (nip05Failed.length > 0 && nip05IntervalMs === 0) {
  console.warn(
    `  NIP-05:   WARNING — storage.nip05.refreshIntervalMs is 0, so the allowlist for ${nip05Failed.join(", ")} stays EMPTY until the server is restarted`,
  );
} else if (nip05Failed.length > 0) {
  console.warn(`  NIP-05:   retrying ${nip05Failed.join(", ")} in ${nip05RetryMs / 1000}s`);
}
// Always started (rules can gain domains at runtime); a refresh with no domains does nothing.
// A failed startup fetch is retried soon rather than after the full interval.
runtime.startNip05({ initialDelayMs: nip05Failed.length > 0 ? nip05RetryMs : undefined });

// Build Hono app (async — landing router loads the prebuilt client JS at startup).
const app = await buildApp(db, storage, config, { metrics, runtime, configPath });
const metricsServer = metrics ? Deno.serve({ hostname: config.metrics.host, port: config.metrics.port }, metrics.fetch) : undefined;
const inventory = metrics ? new InventoryCollector(db, metrics.operations) : undefined;
inventory?.start(config.metrics.inventoryIntervalMs);

// Start the prune loop. It is always scheduled because storage rules can change
// at runtime; cycles with no rules and no ownerless cleanup do no work.
let stopping = false;
runtime.prune.start();

const server = Deno.serve(
  {
    hostname: config.host,
    port: config.port,
    onListen({ port, hostname }) {
      console.log(`\nBlossom Server listening on http://${hostname}:${port}`);
      console.log("  BUD-01: GET/HEAD /:sha256       ready");
      console.log(
        "  BUD-02: PUT /upload             " +
          (config.upload.enabled ? "ready" : "disabled"),
      );
      console.log("  BUD-02: DELETE /:sha256         ready");
      console.log(
        "  BUD-04: PUT /mirror             " +
          (config.mirror.enabled ? "ready" : "disabled"),
      );
      console.log(
        "  BUD-06: HEAD /upload            " +
          (config.upload.enabled ? "ready" : "disabled"),
      );
      console.log(
        "  BUD-09: PUT /report             " +
          (config.report.enabled ? "ready" : "disabled"),
      );
      console.log(
        "  BUD-11: Auth                    " +
          (config.upload.requireAuth ? "required" : "optional"),
      );
      console.log(
        "  Landing: GET /                  " +
          (config.landing.enabled ? "ready" : "disabled"),
      );
      console.log(
        "  Prune:   storage rules          " +
          (runtime.prune.enabled
            ? `active (${runtime.rules.current().length} rules, first run in ${config.prune.initialDelayMs / 1000}s)`
            : "idle (no rules configured)"),
      );
      console.log(
        "  NIP-05:  domain allowlists      " +
          (runtime.nip05.domains.length > 0
            ? `active (${runtime.nip05.domains.length} domains, refresh ${nip05IntervalMs > 0 ? `every ${nip05IntervalMs / 1000}s` : "at startup only"})`
            : "idle (no rules with nip05Domains)"),
      );
      console.log(
        "  Admin:   dashboard              " +
          (config.dashboard.enabled ? `ready (user=${config.dashboard.username}) — http://${hostname}:${port}/admin` : "disabled"),
      );
    },
  },
  app.fetch,
);

// Graceful shutdown
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await inventory?.stop();
  console.log("\nShutting down...");
  await stopServerRuntime(runtime);
  pool.shutdown();
  metricsServer?.shutdown();
  server.shutdown();
  db.close();

  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
