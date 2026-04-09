# Architecture

**Analysis Date:** 2026-04-09

## Pattern Overview

**Overall:** Monolithic Hono HTTP server with sub-app routing, worker pool concurrency, and storage abstraction

**Key Characteristics:**
- Single Deno process with Web Worker isolates for upload I/O
- Builder pattern for composing routes: each route module exports a `build*Router()` function that receives `(db, storage, config)` and returns a `Hono` sub-app
- Two-phase streaming writes: temp file + atomic commit (rename for local, upload for S3)
- Content-addressed storage: SHA-256 hash is the blob identity, computed during upload in a single streaming pass
- BUD protocol compliance (Blossom Upload/Download specs 01-11)

## Layers

**Configuration Layer:**
- Purpose: Load, validate, and normalize config from YAML + env vars
- Location: `src/config/`
- Contains: Zod schema (`src/config/schema.ts`), YAML loader with `${ENV_VAR}` interpolation (`src/config/loader.ts`)
- Depends on: `@std/yaml`, `zod`
- Used by: `main.ts` (startup), all route builders receive `Config` object

**Middleware Layer:**
- Purpose: Cross-cutting request processing applied to all routes
- Location: `src/middleware/`
- Contains: Auth parsing (`auth.ts`), CORS (`cors.ts`), error formatting (`errors.ts`), request logging (`logger.ts`), debug logging (`debug.ts`)
- Depends on: `nostr-tools` (auth signature verification), `@std/encoding` (base64url)
- Used by: `src/server.ts` (middleware registration), route handlers (auth enforcement)

**Route Layer:**
- Purpose: HTTP endpoint handlers implementing BUD protocol + admin dashboard
- Location: `src/routes/`
- Contains: One file per BUD operation + admin router + landing page
- Depends on: Middleware layer, DB layer, Storage layer, Worker pool
- Used by: `src/server.ts` (route composition)

**Database Layer:**
- Purpose: SQLite/libSQL metadata storage for blob records, ownership, reports
- Location: `src/db/`
- Contains: Client init (`client.ts`), query functions (`blobs.ts`, `reports.ts`), worker communication bridge (`bridge.ts`, `proxy.ts`, `handle.ts`, `direct.ts`), SQL migrations (`migrations/`)
- Depends on: `@libsql/client`
- Used by: Route handlers, worker pool, prune engine

**Storage Layer:**
- Purpose: Abstract blob persistence (read/write/delete physical files)
- Location: `src/storage/`
- Contains: Interface (`interface.ts`), local filesystem adapter (`local.ts`), S3-compatible adapter (`s3.ts`)
- Depends on: `@bradenmacdonald/s3-lite-client` (S3 only)
- Used by: Route handlers, prune engine

**Worker Layer:**
- Purpose: Off-main-thread upload I/O with concurrent SHA-256 hashing
- Location: `src/workers/`
- Contains: Pool manager (`pool.ts`), worker script (`upload-worker.ts`)
- Depends on: DB layer (via bridge/proxy or direct), `@std/crypto`
- Used by: Upload route (`src/routes/upload.ts`), media route (`src/routes/media.ts`), mirror route (`src/routes/mirror.ts`)

**Optimization Layer:**
- Purpose: Image/video transcoding for the BUD-05 media endpoint
- Location: `src/optimize/`
- Contains: Dispatcher (`index.ts`), image processing via sharp (`image.ts`), video transcoding via FFmpeg subprocess (`video.ts`)
- Depends on: `sharp` (images), FFmpeg binary (videos), `file-type` (MIME detection)
- Used by: Media route (`src/routes/media.ts`)

**Prune Layer:**
- Purpose: Background cleanup of expired and ownerless blobs
- Location: `src/prune/`
- Contains: Prune engine (`prune.ts`), rule evaluation helpers (`rules.ts`)
- Depends on: DB layer, Storage layer
- Used by: `main.ts` (background loop via recursive `setTimeout`)

**Admin UI Layer:**
- Purpose: Server-rendered admin dashboard pages (Hono JSX)
- Location: `src/admin/`
- Contains: Page components (`blobs-page.tsx`, `users-page.tsx`, etc.), layout (`layout.tsx`), Nostr profile loader (`nostr-profile.ts`)
- Depends on: `applesauce-*` libs (Nostr relay communication for profile lookup)
- Used by: Admin router (`src/routes/admin-router.tsx`)

**Landing Page Layer:**
- Purpose: Public-facing server info page with optional client-side upload UI
- Location: `src/landing/` (server components) + `src/landing/client/` (client-side React app)
- Contains: SSR pages (`page.tsx`, `layout.tsx`, `server-info.tsx`), client app (`client/App.tsx`, `client/UploadForm.tsx`)
- Used by: Landing router (`src/routes/landing.tsx`)

## Data Flow

**Upload Flow (BUD-02 PUT /upload):**

1. Request enters Hono middleware chain: logger → CORS → auth parser
2. Upload route handler validates: auth → Content-Length → size limit → MIME allowlist → X-SHA-256 format → x-tag authorization
3. Dedup check: if X-SHA-256 provided and blob exists in DB, short-circuit with existing descriptor
4. `storage.beginWrite()` allocates a temp file path
5. `pool.dispatch(requestBody, tmpPath)` transfers the stream (zero-copy) to least-loaded worker
6. Worker `tee()`s the stream: branch 1 computes SHA-256 via `@std/crypto`, branch 2 writes to temp file via `TransformStream` counting bytes
7. Worker posts `{ hash, size }` back to main thread
8. Main thread calls `storage.commitWrite(session, hash, ext)` — atomic rename for local, S3 upload for S3
9. Main thread calls `insertBlob(db, record, pubkey)` — writes blob + owner + accessed rows
10. Returns BlobDescriptor JSON

**Media Upload Flow (BUD-05 PUT /media):**

1. Steps 1-7 same as upload (uses same worker pool)
2. After worker returns original hash: strict x-tag verification (required for /media)
3. Dedup check via `media_derivatives` table: if original already optimized, return existing
4. `optimizeMedia(tmpPath, config.media)` dispatches to `image.ts` (sharp) or `video.ts` (FFmpeg)
5. Remove original temp file, re-hash optimized output
6. `storage.commitFile(optimizedPath, hash, ext)` — commits optimized file
7. `insertBlob()` + `insertMediaDerivative()` — records both blob and original→optimized mapping
8. Returns BlobDescriptor for the optimized blob

**Download Flow (BUD-01 GET /:sha256):**

1. Extract 64-char hex hash from URL segment
2. `getBlob(db, hash)` — lookup metadata (type, size, uploaded)
3. `storage.has(hash, ext)` — verify physical file exists
4. `touchBlob(db, hash, now)` — update last-access timestamp (fire-and-forget, for prune)
5. ETag/If-None-Match check → 304 if matched (no storage I/O)
6. Range header? → `storage.readRange()` or stream-slice fallback → 206
7. Full read: `storage.read(hash, ext)` → zero-copy `ReadableStream` → HTTP response

**Prune Flow (background):**

1. `main.ts` starts a recursive `setTimeout` loop (initial delay + interval from config)
2. Phase 1 — Rule-based: for each storage rule, query blobs matching MIME pattern where `lastSeen < now - parseDuration(expiration)`, delete from DB + storage
3. Phase 2 — Ownerless: query blobs with zero owner rows, delete from DB + storage

**State Management:**
- Database is the single source of truth for blob metadata and ownership
- Storage backends are append-only (except prune/delete) with content-addressed naming
- Worker pool maintains job state via `pending` Map keyed by job ID
- Config is immutable after startup (loaded once, passed by reference)

## Key Abstractions

**IBlobStorage:**
- Purpose: Storage backend abstraction enabling local filesystem and S3 interchangeability
- Interface: `src/storage/interface.ts`
- Implementations: `src/storage/local.ts` (LocalStorage), `src/storage/s3.ts` (S3Storage)
- Pattern: Strategy pattern — selected at startup based on `config.storage.backend`
- Key methods: `beginWrite/commitWrite/abortWrite` (two-phase write), `read/readRange` (streaming read), `has/size/remove`, `commitFile` (for media optimization output)

**IDbHandle:**
- Purpose: Database access abstraction that works identically on main thread and in workers
- Interface: `src/db/handle.ts`
- Implementations: `src/db/proxy.ts` (DbProxy — MessageChannel-based for local SQLite), `src/db/direct.ts` (DirectDbHandle — direct libSQL client for remote DB)
- Pattern: Proxy pattern — workers call the same API regardless of DB location; the transport is hidden

**DbBridge/DbProxy:**
- Purpose: Cross-isolate database access for Web Workers when using local SQLite
- Bridge (main thread): `src/db/bridge.ts` — receives named operations via MessagePort, executes against real Client
- Proxy (worker): `src/db/proxy.ts` — sends operations via MessagePort, returns Promises
- Pattern: RPC over MessageChannel with discriminated union allowlist (no arbitrary SQL)

**UploadWorkerPool:**
- Purpose: Pre-warmed pool of Deno Workers for concurrent upload I/O + hashing
- Location: `src/workers/pool.ts`
- Pattern: Singleton pool with no queue (returns null when full → 503). Least-loaded routing via throughput heartbeats
- Job dispatch: zero-copy stream transfer via `postMessage` with Transferable

**Config (Zod schema):**
- Purpose: Strongly-typed, validated configuration with sensible defaults
- Location: `src/config/schema.ts`
- Pattern: Zod schemas with `.default()` and `.transform()` — config file can be empty/partial

**BlossomVariables:**
- Purpose: Typed Hono context variables for auth state propagation
- Location: `src/middleware/auth.ts`
- Contains: `auth` (parsed NostrEvent), `authType` (BUD-11 verb), `authExpiration`
- Pattern: Hono generic `Variables` type — threaded through `Hono<{ Variables: BlossomVariables }>`

## Entry Points

**Main entry (`main.ts`):**
- Location: `/home/robert/Projects/blossom-server/main.ts`
- Triggers: `deno run main.ts [config.yml]`
- Responsibilities: Orchestrates startup sequence — config → DB init → storage init → worker pool init → app build → Deno.serve() → prune loop → graceful shutdown handlers

**App builder (`src/server.ts`):**
- Location: `src/server.ts`
- Triggers: Called once by `main.ts`
- Responsibilities: Assembles the Hono app — registers global middleware, mounts landing/admin/blossom sub-apps in correct order

**Upload worker (`src/workers/upload-worker.ts`):**
- Location: `src/workers/upload-worker.ts`
- Triggers: Spawned by `UploadWorkerPool` constructor as `new Worker()`
- Responsibilities: Receives init message (DB config), then handles job messages (stream → hash + disk write)

## Error Handling

**Strategy:** Layered error handling — each sub-app has its own `onError`, with a global fallback

**Patterns:**
- Blossom protocol routes use a sub-app `onError` that returns `text/plain` with `X-Reason` header (BUD-01 compliant) — `src/routes/blossom-router.ts`
- Global fallback `onError` preserves `HTTPException.res` (e.g., basicAuth's `WWW-Authenticate`) — `src/middleware/errors.ts`
- Route handlers use `errorResponse()` helper for controlled error responses with specific status codes
- Worker errors are caught per-job and posted back as `{ id, error }` messages
- Prune errors are caught per-blob (loop always completes, never throws)
- Temp file cleanup is always attempted in `catch`/`finally` blocks (`.catch(() => {})` pattern)

## Cross-Cutting Concerns

**Logging:** Console-based. `requestLogger` middleware logs method/path/status/duration. `debug()` helper for conditional verbose upload/media tracing (`src/middleware/debug.ts`)

**Validation:** Zod for config validation (`src/config/schema.ts`). Manual validation in route handlers (regex for SHA-256 format, parseInt for Content-Length, MIME allowlist via storage rules)

**Authentication:** BUD-11 Nostr auth — `authMiddleware` parses `Authorization: Nostr <base64url>` header on every request (never blocks). Route handlers call `requireAuth(ctx, verb)` or `optionalAuth(ctx)` to enforce. Auth events are kind 24242 with `t` (verb), `expiration`, optional `server` and `x` (hash) tags. Signature verified via `nostr-tools/pure` `verifyEvent()`

**Content Addressing:** All blobs are identified by their SHA-256 hash. The hash is computed during upload (worker), verified against `X-SHA-256` header if provided, and used as the storage key and DB primary key

**Deduplication:** Three levels: (1) pre-upload via `X-SHA-256` + `hasBlob()` check, (2) `commitWrite()` no-ops if blob already on disk, (3) media derivatives table maps original→optimized hash

---

*Architecture analysis: 2026-04-09*
