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
import { installDbBridge } from "./src/db/bridge.ts";
import { buildApp } from "./src/server.ts";
import { pruneStorage } from "./src/prune/prune.ts";

const configPath = Deno.args[0] ?? "config.yml";
const config = await loadConfig(configPath);

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

// Init upload worker pool — dbConfig determines whether workers use MessageChannel
// (local SQLite) or open their own direct connections (remote libSQL / Turso).
const pool = initPool(
  config.upload.workers,
  config.upload.maxJobsPerWorker,
  config.upload.throughputWindowMs,
  db,
  dbConfig,
);
console.log(`  Workers:  ${pool.size} upload workers`);

// Build landing page client if enabled and dist is stale
if (config.landing.enabled) {
  await runViteBuild(
    "Landing",
    "./landing",
    "Landing page client JS will be unavailable. Fix build errors and restart.",
  );
}

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

// Resolve admin dashboard password (auto-generate if blank)
let adminPassword: string | undefined;
if (config.dashboard.enabled) {
  if (config.dashboard.password) {
    adminPassword = config.dashboard.password;
  } else {
    // Generate a random 20-char alphanumeric password
    const bytes = new Uint8Array(15);
    crypto.getRandomValues(bytes);
    adminPassword = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "")
      .slice(0, 20);
    console.log(`  Admin:    password auto-generated: ${adminPassword}`);
  }

  // Build the admin dashboard if dist is missing or source is newer than dist.
  // This ensures the React Admin SPA is always up-to-date on startup without
  // requiring a separate manual build step.
  await runViteBuild(
    "Admin",
    "./admin",
    "Dashboard will be unavailable. Fix build errors and restart.",
  );
}

/**
 * Run a Vite build for a sub-project using Deno's npm: specifier support.
 * Equivalent to `deno run --allow-all npm:vite build` in the given directory.
 *
 * Skips the build if `<projectDir>/dist/index.html` already exists and is
 * newer than any file in `<projectDir>/src/` — rebuild only on source changes.
 *
 * @param label      Short label for console output (e.g. "Admin", "Landing")
 * @param projectDir Path to the Vite project directory (relative to CWD)
 * @param unavailableMsg Message to show when the build fails and the feature won't work
 */
async function runViteBuild(
  label: string,
  projectDir: string,
  unavailableMsg: string,
): Promise<void> {
  const distIndex = `${projectDir}/dist/index.html`;
  const srcDir = `${projectDir}/src`;
  const pad = label.padEnd(8);

  // Stale-check: compare mtime of dist/index.html against newest file in src/
  let needsBuild = true;
  try {
    const distMtime = (await Deno.stat(distIndex)).mtime?.getTime() ?? 0;
    let srcNewest = 0;
    for await (const entry of Deno.readDir(srcDir)) {
      const mtime =
        (await Deno.stat(`${srcDir}/${entry.name}`)).mtime?.getTime() ?? 0;
      if (mtime > srcNewest) srcNewest = mtime;
    }
    if (distMtime >= srcNewest) needsBuild = false;
  } catch {
    // dist doesn't exist yet — must build
  }

  if (!needsBuild) {
    console.log(`  ${pad}  dist is up-to-date, skipping build`);
    return;
  }

  console.log(`  ${pad}  building (vite)...`);

  // `deno run --allow-all npm:vite build` resolves Vite from the project's
  // own node_modules (via the cwd) — no global Node.js installation needed.
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "npm:vite", "build"],
    cwd: projectDir,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  const dec = new TextDecoder();

  if (code !== 0) {
    console.error(`  ${pad}  build FAILED:\n` + dec.decode(stderr));
    console.error(`  ${pad}  ${unavailableMsg}`);
  } else {
    const summary = dec.decode(stdout).trim().split("\n")
      .findLast((l: string) => l.includes("built in"));
    console.log(
      `  ${pad}  build complete${summary ? " — " + summary.trim() : ""}`,
    );
  }
}

// Build Hono app
const app = buildApp(db, storage, config, landingWorker, adminPassword);

// Start prune loop — runs if any storage rules are configured or removeWhenNoOwners is set.
// Uses recursive setTimeout (not setInterval) so the next run starts only after the
// current one fully completes, preventing overlapping runs under slow I/O.
const pruneEnabled = config.storage.rules.length > 0 ||
  config.storage.removeWhenNoOwners;
let pruneTimeout: ReturnType<typeof setTimeout> | undefined;
if (pruneEnabled) {
  const runPrune = async () => {
    try {
      const result = await pruneStorage(
        db,
        storage,
        config.storage.rules,
        config.storage.removeWhenNoOwners,
      );
      if (result.deleted > 0 || result.errors > 0) {
        console.log(
          `[prune] deleted=${result.deleted} errors=${result.errors}`,
        );
      }
    } catch (err) {
      console.error("[prune] Unexpected error in prune loop:", err);
    }
    pruneTimeout = setTimeout(runPrune, config.prune.intervalMs);
  };
  pruneTimeout = setTimeout(runPrune, config.prune.initialDelayMs);
}

// Start server
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
        "  BUD-11: Auth                    " +
          (config.upload.requireAuth ? "required" : "optional"),
      );
      console.log(
        "  Landing: GET /                  " +
          (config.landing.enabled ? "ready" : "disabled"),
      );
      console.log(
        "  Prune:   storage rules          " +
          (pruneEnabled
            ? `active (${config.storage.rules.length} rules, first run in ${
              config.prune.initialDelayMs / 1000
            }s)`
            : "disabled (no rules configured)"),
      );
      console.log(
        "  Admin:   dashboard              " +
          (config.dashboard.enabled
            ? `ready (user=${config.dashboard.username}) — http://${hostname}:${port}/admin`
            : "disabled"),
      );
    },
  },
  app.fetch,
);

// Graceful shutdown
const shutdown = () => {
  console.log("\nShutting down...");
  if (pruneTimeout !== undefined) clearTimeout(pruneTimeout);
  pool.shutdown();
  landingWorker?.terminate();
  server.shutdown().then(() => {
    console.log("Server stopped.");
    db.close();
  });
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
