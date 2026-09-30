<!-- refreshed: 2026-09-30 -->

# Architecture

**Analysis Date:** 2026-09-30

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                         Deno Runtime                         │
│ `main.ts` — config, DB, storage, workers, prune, serve       │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Hono HTTP Application                     │
│ `src/server.ts` — middleware and router composition          │
├───────────────────┬──────────────────┬──────────────────────┤
│ Blossom protocol  │ Landing page     │ Admin dashboard      │
│ `src/routes/`     │ `src/landing/`   │ `src/admin/`         │
│ `src/routes/`     │ SSR + island     │ SSR + actions        │
└─────────┬─────────┴────────┬─────────┴─────────┬────────────┘
          │                  │                   │
          ▼                  ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│             Domain adapters and supporting services          │
│ `src/db/` · `src/storage/` · `src/workers/` · `src/optimize/`│
│ `src/prune/` · `src/utils/`                                  │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ LibSQL metadata + local disk or S3 blob storage              │
│ `src/db/migrations/` · `src/storage/local.ts` · `s3.ts`      │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component         | Responsibility                                                                           | File                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Process bootstrap | Loads configuration, initializes DB/storage/worker pool, starts pruning and HTTP serving | `main.ts`                                                               |
| App composition   | Installs global middleware and mounts optional UI plus Blossom routers                   | `src/server.ts`                                                         |
| Protocol router   | Composes BUD route handlers and formats protocol errors                                  | `src/routes/blossom-router.ts`                                          |
| Protocol handlers | Validate requests and coordinate auth, metadata, storage, and streaming                  | `src/routes/upload.ts`, `src/routes/blobs.ts`, `src/routes/media.ts`    |
| Database access   | Owns LibSQL client lifecycle, SQL operations, DB handle and worker bridge                | `src/db/client.ts`, `src/db/blobs.ts`, `src/db/reports.ts`              |
| Storage adapters  | Implement blob reads, writes, commits, and removal for disk or S3                        | `src/storage/interface.ts`, `src/storage/local.ts`, `src/storage/s3.ts` |
| Upload workers    | Stream request data to temporary files and calculate SHA-256                             | `src/workers/pool.ts`, `src/workers/upload-worker.ts`                   |
| Media processing  | Dispatches image/video optimization and thumbnail generation                             | `src/optimize/index.ts`, `src/optimize/thumbnail.ts`                    |
| Retention engine  | Evaluates storage rules and deletes expired or ownerless blobs                           | `src/prune/rules.ts`, `src/prune/prune.ts`                              |
| Admin UI          | Renders authenticated dashboard pages and handles administrative actions                 | `src/routes/admin-router.tsx`, `src/admin/`                             |
| Landing UI        | Server-renders the landing page and hydrates its upload client island                    | `src/routes/landing.tsx`, `src/landing/`                                |

## Pattern Overview

**Overall:** Modular monolith with Hono route sub-apps, explicit storage/database adapters, and worker-isolated upload processing.

**Key Characteristics:**

- `main.ts` owns process lifecycle and injects initialized dependencies into `buildApp` and the prune loop.
- Route builders receive the LibSQL `Client`, `IBlobStorage`, and parsed `Config`; protocol handlers mostly issue named SQL helpers in `src/db/blobs.ts` and
  `src/db/reports.ts`.
- `IBlobStorage` isolates local filesystem and S3 behavior. Writes use a temporary-file session and commit only after bytes are verified.
- Hono global middleware parses auth without enforcing it. Each route chooses the relevant auth operation; admin Basic Auth is scoped to its own sub-app.
- The landing client is bundled separately from the server and emitted to `public/client.js`; Hono JSX handles server rendering.

## Layers

**Process and configuration:**

- Purpose: Resolve YAML plus environment interpolation and create long-lived runtime services.
- Location: `main.ts`, `src/config/loader.ts`, `src/config/schema.ts`
- Contains: Startup/shutdown ordering, Zod schema/defaults, storage backend selection, prune scheduling.
- Depends on: Deno runtime and adapters below.
- Used by: Hono application, upload workers, prune engine.

**HTTP composition and routes:**

- Purpose: Apply request middleware and implement Blossom protocol, landing, and admin endpoints.
- Location: `src/server.ts`, `src/routes/`
- Contains: Hono app builders and request/response policy.
- Depends on: Config, middleware, database helpers, storage interface, worker pool.
- Used by: `Deno.serve()` through `app.fetch` in `main.ts`.

**Persistence and storage:**

- Purpose: Store metadata/ownership/report relationships separately from binary blob bytes.
- Location: `src/db/`, `src/storage/`
- Contains: SQL functions/migrations, LibSQL handles, local and S3 storage implementations.
- Depends on: `@libsql/client`, Deno filesystem, S3 client.
- Used by: Routes, workers, admin pages, and prune engine.

**Background processing:**

- Purpose: Perform upload hashing/writes away from the main request event loop, optimize media, and prune retained blobs.
- Location: `src/workers/`, `src/optimize/`, `src/prune/`
- Contains: Worker pool/protocol, media processors, retention rule engine.
- Depends on: Deno workers/streams, DB/storage interfaces, configured tools such as `ffmpeg`.
- Used by: Upload/media route handlers and startup scheduling.

## Data Flow

### Upload (`PUT /upload`)

1. `main.ts` initializes config, DB, storage, and workers before creating the server.
2. `src/server.ts` applies logging, CORS, auth parsing, and static serving, then mounts the Blossom app.
3. `src/routes/upload.ts` enforces configured auth and validates length, MIME rules, hash, and deduplication before dispatch.
4. `src/workers/pool.ts` transfers the request stream to an available worker; `src/workers/upload-worker.ts` writes a temp file and computes SHA-256 in one
   streaming pass.
5. The route verifies the result, commits through `IBlobStorage`, writes blob/owner metadata via `src/db/blobs.ts`, and returns a descriptor.

### Blob retrieval (`GET`/`HEAD /:sha256`)

1. `src/routes/blobs.ts` extracts the hash and reads its metadata through `src/db/blobs.ts`.
2. The route derives the stored extension from MIME metadata and asks the storage adapter for existence/content.
3. It handles conditional and range requests, then returns a streamed response; successful reads update last-access time for pruning.

### Media upload (`PUT /media`)

1. `src/routes/media.ts` applies upload-style authorization and validation, then delegates stream hashing/writing to the worker pool.
2. The route invokes `src/optimize/index.ts` and thumbnail helpers in `src/optimize/`, retaining original/derivative metadata as configured.
3. Verified files are committed through `IBlobStorage`; records and derivative relationships are stored through `src/db/blobs.ts`.

### Retention pruning

1. `main.ts` schedules the first prune pass when rules or ownerless cleanup are enabled.
2. `src/prune/prune.ts` pages through DB candidates, applies ordered MIME/pubkey rules, and removes metadata and physical files through the injected adapters.
3. A recursive timeout schedules the next pass after the prior pass completes.

**State Management:**

- Blob content is immutable and content-addressed by SHA-256; LibSQL is the metadata and ownership index.
- Runtime clients and pool are module-level singletons in `src/db/client.ts` and `src/workers/pool.ts`, initialized once by `main.ts`.
- Prune cursors live in the process in `PruneState`; restart begins new cursors.
- Admin profile lookup uses module-scoped reactive state in `src/admin/nostr-profile.ts`.

## Key Abstractions

**`IBlobStorage`:**

- Purpose: Uniform read/range/write/commit/remove operations across disk and S3.
- Examples: `src/storage/local.ts`, `src/storage/s3.ts`
- Pattern: `beginWrite` creates a temporary local write session; successful hash verification precedes `commitWrite` or `commitFile`.

**Database handles:**

- Purpose: Give worker code a stable API independent of local versus remote DB transport.
- Examples: `src/db/handle.ts`, `src/db/direct.ts`, `src/db/proxy.ts`
- Pattern: Remote workers use `DirectDbHandle`; local SQLite workers call `DbProxy`, whose named operations are executed by `src/db/bridge.ts` on the
  main-thread client.

**Route builders:**

- Purpose: Assemble independent Hono applications around injected dependencies.
- Examples: `src/routes/blossom-router.ts`, `src/routes/upload.ts`, `src/routes/admin-router.tsx`
- Pattern: Export `build*Router(...)`, register specific paths before broad catch-alls, and mount sub-apps in `src/server.ts`.

## Entry Points

**Deno server process:**

- Location: `main.ts`
- Triggers: `deno task start`, `deno task dev`, Docker, or Nix wrapper.
- Responsibilities: Load config; perform optional legacy DB migration; initialize DB/storage/workers; start pruning and `Deno.serve`; shut down resources on
  SIGINT/SIGTERM.

**HTTP app factory:**

- Location: `src/server.ts`
- Triggers: Called from `main.ts` after service initialization; also used by tests through `app.fetch()`.
- Responsibilities: Build middleware chain and mount landing/admin/Blossom routers.

**Landing client bundle:**

- Location: `src/landing/client/index.tsx`
- Triggers: Built by `deno task build:client` and loaded by the landing page in browsers.
- Responsibilities: Hydrate the upload island with browser-side upload and mirror flows.

## Architectural Constraints

- **Threading:** Main Deno isolate serves requests; upload workers are persistent isolates created in `src/workers/pool.ts`. No work queue exists; full capacity
  returns `null` for route-level 503 handling.
- **Global state:** DB and worker pool singletons live in `src/db/client.ts` and `src/workers/pool.ts`; dashboard relay lookup state lives in
  `src/admin/nostr-profile.ts`.
- **Circular imports:** No intentional circular import chain detected in the runtime composition inspected.
- **Route order:** Mount `/upload`, `/mirror`, `/media`, `/report`, `/list/:pubkey`, and `/admin` before blob catch-all `/:filename`; protocol order is explicit
  in `src/routes/blossom-router.ts`.
- **Streaming:** Keep request and blob bodies as Web Streams. Rejecting upload paths cancel or drain the body as appropriate; avoid buffering full blobs.
- **DB worker boundary:** Local SQLite access remains on the main thread and is exposed through an allowlisted MessageChannel protocol in `src/db/bridge.ts`;
  remote libSQL workers construct their own clients.
- **S3 write integrity:** `src/storage/s3.ts` stages bytes locally and transfers only verified files to S3.

## Anti-Patterns

### Bypassing the storage adapter

**What happens:** Route or domain code directly manipulates backend-specific paths or S3 object keys instead of using `IBlobStorage`. **Why it's wrong:** It
couples protocol behavior to one backend and bypasses atomic commit/cleanup semantics. **Do this instead:** Add behavior to `src/storage/interface.ts` and
implement it in `src/storage/local.ts` and `src/storage/s3.ts`.

### Adding an unmounted catch-all route

**What happens:** A specific route is mounted after the blob filename matcher in `src/routes/blossom-router.ts`. **Why it's wrong:** The broad matcher may
consume the request before its intended handler. **Do this instead:** Register exact protocol paths before `buildBlobsRouter` and mount `/admin` before the
Blossom router in `src/server.ts`.

### Accessing local SQLite directly from a worker

**What happens:** A worker attempts to reuse the main isolate's local LibSQL client. **Why it's wrong:** Local SQLite file handles are isolate-bound. **Do this
instead:** Add a typed operation to `src/db/bridge.ts`, expose it through `src/db/proxy.ts` and `src/db/handle.ts`, and implement the direct path in
`src/db/direct.ts`.

## Error Handling

**Strategy:** Route handlers return protocol-specific error responses for expected failures and throw `HTTPException` for exceptional control flow. Global Hono
handling formats non-Blossom failures; Blossom routes have a scoped BUD-01 `X-Reason`/`text/plain` handler in `src/routes/blossom-router.ts`.

**Patterns:**

- `src/middleware/errors.ts` provides `errorResponse()` and the parent app `onError` handler.
- Auth parsing middleware in `src/middleware/auth.ts` populates context; endpoint handlers explicitly call `requireAuth()` or `optionalAuth()`.
- Worker errors are serialized with error types in `src/workers/upload-worker.ts` and restored as `WorkerJobError` in `src/workers/pool.ts`.
- Best-effort cleanup and secondary updates catch failures locally, for example storage removal and last-access updates.

## Cross-Cutting Concerns

**Logging:** `src/middleware/logger.ts` logs requests; `src/middleware/debug.ts` gates detailed route diagnostics; startup, worker, prune, and cleanup failures
use console logging. **Validation:** `src/config/schema.ts` validates config with Zod; route handlers validate request fields and protocol payloads.
**Authentication:** `src/middleware/auth.ts` verifies BUD-11 Nostr events and route-specific tags; `src/routes/admin-router.tsx` applies Hono HTTP Basic Auth to
the admin sub-app.

---

_Architecture analysis: 2026-09-30_
