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
import { initDb } from "./src/db/client.ts";
import { LocalStorage } from "./src/storage/local.ts";
import { initPool } from "./src/workers/pool.ts";
import { buildApp } from "./src/server.ts";

const configPath = Deno.args[0] ?? "config.yml";
const config = await loadConfig(configPath);

console.log("Blossom Server starting...");
console.log(`  Config:   ${configPath}`);
console.log(`  Database: ${config.databasePath}`);
console.log(`  Storage:  ${config.storage.backend}`);
console.log(`  Port:     ${config.port}`);

// Init database
const db = await initDb(config.databasePath);
console.log("  Database: ready");

// Init storage
let storage: LocalStorage;
if (config.storage.backend === "local") {
  const dir = config.storage.local?.dir ?? "./data/blobs";
  storage = new LocalStorage(dir);
  await storage.setup();
  console.log(`  Storage:  local (${dir})`);
} else {
  // S3 adapter not yet implemented
  console.error("S3 storage backend is not yet implemented.");
  Deno.exit(1);
}

// Init hash worker pool
const pool = initPool(config.upload.hashWorkers);
console.log(`  Workers:  ${pool.size} hash workers`);

// Build Hono app
const app = buildApp(db, storage, config);

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
    },
  },
  app.fetch,
);

// Graceful shutdown
const shutdown = () => {
  console.log("\nShutting down...");
  pool.shutdown();
  server.shutdown().then(() => {
    console.log("Server stopped.");
    db.close();
  });
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
