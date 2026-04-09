# Codebase Structure

**Analysis Date:** 2026-04-09

## Directory Layout

```
blossom-server/
├── main.ts                    # Entry point — startup orchestration
├── deno.json                  # Deno config, tasks, import map
├── deno.lock                  # Dependency lockfile
├── config.example.yml         # Reference configuration file
├── Dockerfile                 # Container build
├── docker-compose.yml         # Dev/deploy compose
├── src/
│   ├── server.ts              # Hono app assembly (middleware + routes)
│   ├── config/                # Config loading + Zod schema
│   ├── db/                    # Database client, queries, migrations, worker bridge
│   ├── middleware/             # Hono middleware (auth, cors, errors, logging)
│   ├── routes/                # HTTP route handlers (one per BUD endpoint + admin + landing)
│   ├── storage/               # Blob storage abstraction (local + S3)
│   ├── workers/               # Upload worker pool + worker script
│   ├── optimize/              # Media optimization (image/video)
│   ├── prune/                 # Background blob expiry engine
│   ├── utils/                 # Shared utility functions
│   ├── admin/                 # Admin dashboard JSX page components
│   └── landing/               # Landing page (SSR + client-side app)
│       ├── client/            # Client-side React app (bundled separately)
│       ├── layout.tsx         # Landing page HTML layout
│       ├── page.tsx           # Main landing page component
│       ├── server-info.tsx    # Server info display component
│       ├── stats-bar.tsx      # Stats bar component
│       └── upload-island.tsx  # Upload island component
├── admin/                     # Pre-built admin frontend assets
│   └── dist/                  # Built admin assets (committed)
├── public/                    # Static files (favicon, bundled client.js)
├── data/                      # Runtime data directory
│   └── blobs/                 # Default local blob storage
│       └── .tmp/              # Upload temp files
├── build/                     # Legacy Node.js build output (not used by Deno runtime)
├── tests/
│   ├── unit/                  # Unit tests
│   └── e2e/                   # End-to-end tests
└── .github/
    └── workflows/             # CI/CD configuration
```

## Directory Purposes

**`src/config/`:**
- Purpose: Configuration loading and validation
- Contains: YAML parser with env var interpolation, Zod schemas defining all config sections
- Key files: `schema.ts` (all Zod schemas + Config type), `loader.ts` (loadConfig function)

**`src/db/`:**
- Purpose: All database access — schema, queries, migrations, cross-isolate communication
- Contains: Client initialization, named query functions, worker bridge pattern, SQL migrations
- Key files:
  - `client.ts` — `initDb()`, `getDb()`, `DbConfig` type
  - `blobs.ts` — All blob/owner/accessed CRUD queries + admin queries
  - `reports.ts` — Report CRUD queries
  - `handle.ts` — `IDbHandle` interface (shared between main thread and workers)
  - `bridge.ts` — Main-thread side of worker MessageChannel (executes named DB ops)
  - `proxy.ts` — Worker-side MessageChannel proxy (implements IDbHandle)
  - `direct.ts` — Direct DB handle wrapper (for remote libSQL in workers)
  - `legacy-migration.ts` — Migrates from legacy Node.js SQLite format
  - `migrations/` — SQL migration files (run at startup in alphabetical order)

**`src/middleware/`:**
- Purpose: Hono middleware functions applied globally or used by route handlers
- Contains: Auth parsing/enforcement, CORS, error formatting, logging
- Key files:
  - `auth.ts` — `authMiddleware()` (global parser), `requireAuth()`, `optionalAuth()`, `requireXTag()`, `BlossomVariables` type
  - `cors.ts` — CORS headers for BUD-01 compliance
  - `errors.ts` — `errorResponse()` helper, global `onError` handler
  - `logger.ts` — Request/response timing logger
  - `debug.ts` — Conditional verbose debug logging

**`src/routes/`:**
- Purpose: HTTP endpoint handlers — one file per BUD operation
- Contains: Route builder functions that return Hono sub-apps
- Key files:
  - `blossom-router.ts` — Assembles all BUD routes with BUD-01-compliant error handler
  - `blobs.ts` — `GET/HEAD /:sha256[.ext]` (BUD-01 download + range requests)
  - `upload.ts` — `PUT /upload`, `HEAD /upload` (BUD-02 + BUD-06)
  - `delete.ts` — `DELETE /:sha256` (BUD-02)
  - `list.ts` — `GET /list/:pubkey` (BUD-02, optional)
  - `mirror.ts` — `PUT /mirror` (BUD-04)
  - `media.ts` — `PUT /media`, `HEAD /media` (BUD-05)
  - `report.ts` — `PUT /report` (BUD-09)
  - `admin-router.tsx` — Admin dashboard SSR + JSON API endpoints
  - `landing.tsx` — Landing page SSR + client JS serving

**`src/storage/`:**
- Purpose: Blob file storage abstraction
- Contains: Interface definition + two implementations
- Key files:
  - `interface.ts` — `IBlobStorage` and `WriteSession` interfaces
  - `local.ts` — `LocalStorage` class (filesystem, atomic rename)
  - `s3.ts` — `S3Storage` class (S3-compatible object store)

**`src/workers/`:**
- Purpose: Off-main-thread upload processing
- Contains: Worker pool management + worker script
- Key files:
  - `pool.ts` — `UploadWorkerPool` class, `initPool()`, `getPool()` singleton
  - `upload-worker.ts` — Worker entry point (stream tee → hash + write)

**`src/optimize/`:**
- Purpose: Media file optimization/transcoding
- Contains: MIME dispatcher + format-specific processors
- Key files:
  - `index.ts` — `optimizeMedia()` dispatcher (detects MIME, routes to image/video)
  - `image.ts` — `optimizeImage()`, `optimizeGif()` (uses sharp)
  - `video.ts` — `optimizeVideo()` (uses FFmpeg subprocess)

**`src/prune/`:**
- Purpose: Background blob cleanup based on retention rules
- Contains: Prune engine + rule evaluation helpers
- Key files:
  - `prune.ts` — `pruneStorage()` — rule-based expiry + ownerless cleanup
  - `rules.ts` — `getFileRule()` (upload gate), `parseDuration()`, `mimeMatchesRule()`, `mimeToSqlLike()`

**`src/utils/`:**
- Purpose: Shared utility functions
- Contains: MIME/extension helpers, URL builders, stream transforms
- Key files:
  - `mime.ts` — `mimeToExt()` (MIME type → file extension)
  - `url.ts` — `getBaseUrl()`, `getBlobUrl()` (construct blob descriptor URLs)
  - `streams.ts` — `byteLimitTransform()` (TransformStream that caps output to N bytes)

**`src/admin/`:**
- Purpose: Server-rendered admin dashboard page components (Hono JSX)
- Contains: One TSX file per page + shared layout
- Key files:
  - `layout.tsx` — HTML shell with navigation
  - `blobs-page.tsx`, `blob-detail-page.tsx` — Blob management
  - `users-page.tsx`, `user-detail-page.tsx` — User management
  - `reports-page.tsx`, `report-detail-page.tsx` — Report management
  - `rules-page.tsx` — Storage rules display
  - `nostr-profile.ts` — Nostr relay-based profile metadata lookup

**`src/landing/`:**
- Purpose: Public landing page with server info and optional upload UI
- Contains: Server-side rendered components + separately bundled client app
- Key files:
  - `page.tsx`, `layout.tsx`, `server-info.tsx`, `stats-bar.tsx` — SSR components
  - `upload-island.tsx` — Client-side hydration island for upload form
  - `client/` — Full client-side app (bundled via `deno task build-landing`)

## Key File Locations

**Entry Points:**
- `main.ts`: Application entry — config loading, init chain, server start, graceful shutdown
- `src/server.ts`: Hono app assembly — `buildApp(db, storage, config)`
- `src/workers/upload-worker.ts`: Worker entry — `self.onmessage` handler

**Configuration:**
- `config.example.yml`: Reference config with all options documented
- `src/config/schema.ts`: Zod schemas defining all config types and defaults
- `src/config/loader.ts`: YAML loading + env var interpolation
- `deno.json`: Deno runtime config, import map, tasks

**Core Logic:**
- `src/routes/upload.ts`: Upload pipeline (main thread orchestration)
- `src/workers/upload-worker.ts`: Upload I/O (worker isolate — hash + write)
- `src/routes/blobs.ts`: Download pipeline (streaming, range requests, caching)
- `src/routes/media.ts`: Media upload + optimization pipeline
- `src/prune/prune.ts`: Background blob expiry engine

**Database:**
- `src/db/client.ts`: Client initialization + migration runner
- `src/db/blobs.ts`: All blob/owner queries (500+ lines)
- `src/db/reports.ts`: Report queries
- `src/db/migrations/001_initial.sql`: Core schema (blobs, owners, accessed)
- `src/db/migrations/002_media_derivatives.sql`: Media derivative mapping
- `src/db/migrations/003_reports.sql`: Reports table

**Testing:**
- `tests/unit/`: Unit test files
- `tests/e2e/`: End-to-end test files

## Naming Conventions

**Files:**
- `kebab-case.ts` for all source files: `upload-worker.ts`, `blob-detail-page.tsx`
- `.tsx` extension for JSX components (admin pages, landing pages)
- `.ts` extension for all other TypeScript
- `.sql` extension for migrations, numbered sequentially: `001_initial.sql`, `002_media_derivatives.sql`

**Directories:**
- `kebab-case` for all directories: `src/landing/client/`
- Flat structure within each directory (no deep nesting)

**Exports:**
- Route builders: `build*Router(db, storage, config)` — e.g., `buildUploadRouter()`, `buildBlossomRouter()`
- DB queries: named functions taking `(db: Client, ...args)` — e.g., `getBlob()`, `insertBlob()`
- Middleware: named functions — `authMiddleware()`, `corsMiddleware`, `requestLogger`
- Singletons: `init*()` + `get*()` pattern — `initDb()`/`getDb()`, `initPool()`/`getPool()`

## Where to Add New Code

**New BUD endpoint:**
- Create route handler: `src/routes/<bud-name>.ts`
- Export `build<Name>Router(db, storage, config)` returning `Hono<{ Variables: BlossomVariables }>`
- Register in `src/routes/blossom-router.ts` (order matters — exact paths before /:sha256 catch-all)
- Add config section: add Zod schema in `src/config/schema.ts`, add field to `ConfigSchema`

**New database table/query:**
- Add migration: `src/db/migrations/<NNN>_<name>.sql` (use next number)
- Add query functions: `src/db/<entity>.ts` (export named functions taking `(db: Client, ...)`)
- If workers need access: add operation to `DbRequest` union in `src/db/bridge.ts`, handle in switch, add method to `IDbHandle` interface in `src/db/handle.ts`, implement in `src/db/proxy.ts` and `src/db/direct.ts`

**New storage backend:**
- Implement `IBlobStorage` interface from `src/storage/interface.ts`
- Add new class file: `src/storage/<backend>.ts`
- Add config schema section in `src/config/schema.ts`
- Add init branch in `main.ts` storage initialization block

**New middleware:**
- Create: `src/middleware/<name>.ts`
- Register in `src/server.ts` in the `buildApp()` function (order matters)

**New admin page:**
- Create page component: `src/admin/<name>-page.tsx`
- Register route in `src/routes/admin-router.tsx`

**New utility function:**
- Add to appropriate file in `src/utils/` or create new file if distinct concern

**New optimization format:**
- Add handler in `src/optimize/` (new file or extend existing)
- Add MIME dispatch case in `src/optimize/index.ts`

## Special Directories

**`data/`:**
- Purpose: Runtime data (SQLite database file, blob storage)
- Generated: Yes (created at runtime)
- Committed: Directory structure committed, contents gitignored

**`build/`:**
- Purpose: Legacy Node.js compiled output
- Generated: Yes (from prior build system)
- Committed: Yes (appears committed but not used by Deno runtime)

**`admin/dist/`:**
- Purpose: Pre-built admin frontend static assets
- Generated: Yes (built externally)
- Committed: Yes

**`public/`:**
- Purpose: Static files served directly (favicon, bundled landing client JS)
- Generated: `client.js` is generated by `deno task build-landing`
- Committed: Yes

**`src/landing/client/`:**
- Purpose: Client-side landing page app (separate Deno config)
- Generated: No (source code)
- Committed: Yes
- Note: Has its own `deno.json` and `deno.lock`; excluded from main project's compile via `"exclude"` in root `deno.json`

---

*Structure analysis: 2026-04-09*
