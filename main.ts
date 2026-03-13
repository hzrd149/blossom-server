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
import { initDb, type DbConfig } from "./src/db/client.ts";
import { LocalStorage } from "./src/storage/local.ts";
import { initPool } from "./src/workers/pool.ts";
import { installDbBridge } from "./src/db/bridge.ts";
import { buildApp } from "./src/server.ts";

const configPath = Deno.args[0] ?? "config.yml";
const config = await loadConfig(configPath);

// Config schema resolves deprecated databasePath into config.database automatically.
const dbConfig: DbConfig = config.database;
const dbLabel = dbConfig.url ?? `file:${dbConfig.path}`;

console.log("Blossom Server starting...");
console.log(`  Config:   ${configPath}`);
console.log(`  Database: ${dbLabel}`);
console.log(`  Storage:  ${config.storage.backend}`);
console.log(`  Port:     ${config.port}`);

// Init database
const db = await initDb(dbConfig);
console.log("  Database: ready");

// Init storage
let storage: LocalStorage;
let storageDir: string;
if (config.storage.backend === "local") {
  storageDir = config.storage.local?.dir ?? "./data/blobs";
  storage = new LocalStorage(storageDir);
  await storage.setup();
  console.log(`  Storage:  local (${storageDir})`);
} else {
  // S3 adapter not yet implemented
  console.error("S3 storage backend is not yet implemented.");
  Deno.exit(1);
}

// Init upload worker pool — dbConfig determines whether workers use MessageChannel
// (local SQLite) or open their own direct connections (remote libSQL / Turso).
const pool = initPool(config.upload.hashWorkers, db, dbConfig);
console.log(`  Workers:  ${pool.size} upload workers`);

// Init landing page worker (optional — off by default)
let landingWorker: Worker | undefined;
if (config.landing.enabled) {
  const { port1, port2 } = new MessageChannel();
  landingWorker = new Worker(
    new URL("./src/workers/landing-worker.tsx", import.meta.url),
    { type: "module" },
  );
  // Install DB bridge on port1 (main thread) before the worker needs it
  installDbBridge(db, port1);
  // Set handler BEFORE posting init so the ready signal is never missed
  const readyPromise = new Promise<void>((resolve) => {
    landingWorker!.onmessage = (e) => {
      if (e.data?.type === "ready") resolve();
    };
  });
  // Transfer port2 to the worker along with config
  landingWorker.postMessage({ type: "init", dbPort: port2, config }, [port2]);
  await readyPromise;
  // onmessage is taken over by buildLandingRouter after buildApp() runs
  console.log("  Landing:  ready");
}

// Build Hono app
const app = buildApp(db, storage, storageDir, config, landingWorker);

// Start server
const server = Deno.serve(
  {
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
        "  BUD-02: GET /list/:pubkey       " +
          (config.list.enabled ? "ready" : "disabled"),
      );
      console.log(
        "  BUD-06: HEAD /upload            " +
          (config.upload.enabled ? "ready" : "disabled"),
      );
      console.log(
        "  BUD-11: Auth                    " +
          (config.upload.requireAuth ? "required" : "optional"),
      );
      console.log(
        "  Landing: GET /                  " +
          (config.landing.enabled ? "ready" : "disabled"),
      );
    },
  },
  app.fetch,
);

// Graceful shutdown
const shutdown = () => {
  console.log("\nShutting down...");
  pool.shutdown();
  landingWorker?.terminate();
  server.shutdown().then(() => {
    console.log("Server stopped.");
    db.close();
  });
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
