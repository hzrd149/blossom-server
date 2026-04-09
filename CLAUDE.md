<!-- GSD:project-start source:PROJECT.md -->
## Project

**Blossom Server — HTTP Status Code Update**

Update the blossom-server to comply with the new HTTP status code definitions proposed in [hzrd149/blossom#98](https://github.com/hzrd149/blossom/pull/98). The server currently returns generic `2xx`/`4xx` codes; the new spec defines exact status codes for every endpoint to improve interoperability between clients and servers.

**Core Value:** Every endpoint returns the exact HTTP status codes specified in the updated BUD specs, enabling clients and AI agents to understand server behavior from status codes alone.

### Constraints

- **Backwards compatibility**: All changes must be transparent to existing clients that check `2xx` range
- **Spec compliance**: Status codes must match the tables in PR #98 exactly
- **Tech stack**: Deno + Hono + TypeScript — no stack changes
- **No new dependencies**: This is purely status code refinement in existing handlers
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript - TypeScript + JSX for server, admin dashboard, and client code
- JavaScript - Generated bundle code for client-side landing page
- SQL - Database schema and migrations (LibSQL/SQLite)
## Runtime
- Deno 2.x (latest) - Primary runtime for all server code, configured via `deno.json`
- JSR (Jsr Registry) - Primary package manager for Deno packages
- NPM - Used for select packages via Deno's npm: protocol (e.g., `npm:sharp`, `npm:nostr-tools`)
- Lockfile: `deno.lock` (present, auto-managed by Deno)
## Frameworks
- Hono 4.12.7 (JSR) - HTTP server framework for routing, middleware, request handling
- JSX (precompile) - Server-side JSX rendering via `@hono/hono/jsx` for admin dashboard and landing page
- Deno test runner - Built-in Deno testing framework (no external test library required)
- Deno bundle (--unstable-bundle) - Bundles landing page client JS at server startup
- Deno compile - Supported for static binary generation (not used in production, but configured)
- Sharp 0.34.5 (npm) - Image optimization and transcoding (native bindings included)
- FFmpeg - External system dependency for video optimization; installed in Docker via `apt-get install ffmpeg`
## Key Dependencies
- `@libsql/client` 0.17.0 (npm) - Database client for both local SQLite and remote Turso/libSQL connections; implements the actual blob and report schema
- `@hono/hono` 4.12.7 (JSR) - HTTP server and middleware framework; implements all BUD-02/04/06/09/11 endpoint handlers
- `zod` 4.3.6 (npm) - Runtime config schema validation; validates `config.yml` at startup
- `nostr-tools` 2.23.3 (npm) - Nostr event parsing and verification (NIP-56 report validation, NIP-19 key conversion, etc.)
- `sharp` 0.34.5 (npm) - Image optimization (resize, format conversion, EXIF stripping)
- `@bradenmacdonald/s3-lite-client` 0.9.5 (JSR) - S3-compatible object storage client; enables S3/MinIO/DigitalOcean Spaces backend
- `@std/yaml` 1.0.12 (JSR) - YAML config file parsing
- `@std/encoding` 1.0.10 (JSR) - Hex encoding/decoding for hash verification
- `@std/crypto` 1.0.5 (JSR) - SHA-256 hashing for blob integrity verification
- `@std/log` 0.224.14 (JSR) - Structured logging framework
- `@std/path` 1.1.4 (JSR) - Cross-platform path handling
- `@std/ulid` 1.0.0 (JSR) - ULID generation for temp file IDs and blob tracking
- `@std/media-types` 1.1.0 (JSR) - MIME type detection and mapping
- `file-type` 19.6.0 (npm) - Magic bytes file type detection for uploaded blobs
- `applesauce-core`, `applesauce-common`, `applesauce-loaders`, `applesauce-relay` (npm, v5.1.0) - Nostr event handling library ecosystem for admin dashboard profile lookup
- `rxjs` 7.8.0 (npm) - Reactive programming library (used by applesauce for async profile fetching)
## Configuration
- Configuration via YAML file (`config.yml` by default, configurable via CLI argument)
- Environment variable interpolation: `${VAR_NAME}` syntax in config values at startup (`src/config/loader.ts`)
- Critical env vars: `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `TURSO_AUTH_TOKEN` (referenced in config but not auto-loaded)
- `deno.json` - Deno manifest with tasks, imports, JSR/npm mappings, JSX config
- `.prettierrc` - Formatting rules (minimal config)
- `tsconfig.json` - TypeScript options (not explicitly used, but supported by Deno)
- `docker-compose.yml` - Docker Compose for local development (contains sqld for database testing)
- `Dockerfile` - Multi-stage build using `denoland/deno:debian` base image
## Platform Requirements
- Deno 2.x
- Node.js 22.x (for compatibility, as per `.nvmrc`)
- FFmpeg (if testing video optimization locally)
- Docker (optional, for containerized database/storage testing)
- Deno 2.x runtime
- FFmpeg (installed in Docker as system dependency `apt-get install ffmpeg`)
- S3-compatible object storage (optional, if using S3 backend; local filesystem used by default)
- Remote libSQL/Turso database (optional, if using remote; local SQLite default)
- Filesystem with sufficient space for blob storage (local backend) or S3 bucket access (S3 backend)
- Docker containers (primary, uses `denoland/deno:debian` image with Debian-based system dependencies)
- Standalone Deno binary (supported via `deno compile`)
- Bare metal (Deno runtime + system FFmpeg installation)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming
- **Functions:** camelCase (e.g., `buildApp`, `parseAuthEvent`, `extractHostname`)
- **Types/Interfaces:** PascalCase with `I` prefix for interfaces (e.g., `BlossomVariables`, `IBlobStorage`)
- **Files:** lowercase with hyphens (e.g., `auth.ts`, `blossom-router.ts`)
- **Constants:** camelCase for module-level constants
## Formatting
- **Tool:** Prettier with Deno's built-in formatter
- **Line width:** 120 characters
- **Indentation:** 2 spaces, no tabs
- **Linter:** Deno's built-in linter (no ESLint config)
## Imports
- Explicit `.ts` extensions required on all local imports
- Import order: type-only imports first, then external packages, then local modules
- No path aliases configured
## Error Handling
- `HTTPException` from `@hono/hono` for all HTTP errors with explicit status codes
- Try/finally pattern for cleanup (e.g., temp files, resources)
- Never silent failures - always throw or log
## Logging
- `console.log/warn/error/debug` used directly
- Include context tags in log messages (e.g., `[upload]`, `[prune]`)
- JSDoc mandatory for exported functions
## Functions
- camelCase naming
- Builder functions prefixed with `build` (e.g., `buildApp`, `buildBlobDescriptor`)
- Max ~40 lines per function
- Explicit types always (parameters and return types)
- Return `null` not `undefined` for absent values
## Patterns
- Factory functions over classes for constructing objects
- Middleware-based request pipeline (Hono framework)
- Configuration via environment variables with typed accessors
- Async/await throughout (no raw promises or callbacks)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Single Deno process with Web Worker isolates for upload I/O
- Builder pattern for composing routes: each route module exports a `build*Router()` function that receives `(db, storage, config)` and returns a `Hono` sub-app
- Two-phase streaming writes: temp file + atomic commit (rename for local, upload for S3)
- Content-addressed storage: SHA-256 hash is the blob identity, computed during upload in a single streaming pass
- BUD protocol compliance (Blossom Upload/Download specs 01-11)
## Layers
- Purpose: Load, validate, and normalize config from YAML + env vars
- Location: `src/config/`
- Contains: Zod schema (`src/config/schema.ts`), YAML loader with `${ENV_VAR}` interpolation (`src/config/loader.ts`)
- Depends on: `@std/yaml`, `zod`
- Used by: `main.ts` (startup), all route builders receive `Config` object
- Purpose: Cross-cutting request processing applied to all routes
- Location: `src/middleware/`
- Contains: Auth parsing (`auth.ts`), CORS (`cors.ts`), error formatting (`errors.ts`), request logging (`logger.ts`), debug logging (`debug.ts`)
- Depends on: `nostr-tools` (auth signature verification), `@std/encoding` (base64url)
- Used by: `src/server.ts` (middleware registration), route handlers (auth enforcement)
- Purpose: HTTP endpoint handlers implementing BUD protocol + admin dashboard
- Location: `src/routes/`
- Contains: One file per BUD operation + admin router + landing page
- Depends on: Middleware layer, DB layer, Storage layer, Worker pool
- Used by: `src/server.ts` (route composition)
- Purpose: SQLite/libSQL metadata storage for blob records, ownership, reports
- Location: `src/db/`
- Contains: Client init (`client.ts`), query functions (`blobs.ts`, `reports.ts`), worker communication bridge (`bridge.ts`, `proxy.ts`, `handle.ts`, `direct.ts`), SQL migrations (`migrations/`)
- Depends on: `@libsql/client`
- Used by: Route handlers, worker pool, prune engine
- Purpose: Abstract blob persistence (read/write/delete physical files)
- Location: `src/storage/`
- Contains: Interface (`interface.ts`), local filesystem adapter (`local.ts`), S3-compatible adapter (`s3.ts`)
- Depends on: `@bradenmacdonald/s3-lite-client` (S3 only)
- Used by: Route handlers, prune engine
- Purpose: Off-main-thread upload I/O with concurrent SHA-256 hashing
- Location: `src/workers/`
- Contains: Pool manager (`pool.ts`), worker script (`upload-worker.ts`)
- Depends on: DB layer (via bridge/proxy or direct), `@std/crypto`
- Used by: Upload route (`src/routes/upload.ts`), media route (`src/routes/media.ts`), mirror route (`src/routes/mirror.ts`)
- Purpose: Image/video transcoding for the BUD-05 media endpoint
- Location: `src/optimize/`
- Contains: Dispatcher (`index.ts`), image processing via sharp (`image.ts`), video transcoding via FFmpeg subprocess (`video.ts`)
- Depends on: `sharp` (images), FFmpeg binary (videos), `file-type` (MIME detection)
- Used by: Media route (`src/routes/media.ts`)
- Purpose: Background cleanup of expired and ownerless blobs
- Location: `src/prune/`
- Contains: Prune engine (`prune.ts`), rule evaluation helpers (`rules.ts`)
- Depends on: DB layer, Storage layer
- Used by: `main.ts` (background loop via recursive `setTimeout`)
- Purpose: Server-rendered admin dashboard pages (Hono JSX)
- Location: `src/admin/`
- Contains: Page components (`blobs-page.tsx`, `users-page.tsx`, etc.), layout (`layout.tsx`), Nostr profile loader (`nostr-profile.ts`)
- Depends on: `applesauce-*` libs (Nostr relay communication for profile lookup)
- Used by: Admin router (`src/routes/admin-router.tsx`)
- Purpose: Public-facing server info page with optional client-side upload UI
- Location: `src/landing/` (server components) + `src/landing/client/` (client-side React app)
- Contains: SSR pages (`page.tsx`, `layout.tsx`, `server-info.tsx`), client app (`client/App.tsx`, `client/UploadForm.tsx`)
- Used by: Landing router (`src/routes/landing.tsx`)
## Data Flow
- Database is the single source of truth for blob metadata and ownership
- Storage backends are append-only (except prune/delete) with content-addressed naming
- Worker pool maintains job state via `pending` Map keyed by job ID
- Config is immutable after startup (loaded once, passed by reference)
## Key Abstractions
- Purpose: Storage backend abstraction enabling local filesystem and S3 interchangeability
- Interface: `src/storage/interface.ts`
- Implementations: `src/storage/local.ts` (LocalStorage), `src/storage/s3.ts` (S3Storage)
- Pattern: Strategy pattern — selected at startup based on `config.storage.backend`
- Key methods: `beginWrite/commitWrite/abortWrite` (two-phase write), `read/readRange` (streaming read), `has/size/remove`, `commitFile` (for media optimization output)
- Purpose: Database access abstraction that works identically on main thread and in workers
- Interface: `src/db/handle.ts`
- Implementations: `src/db/proxy.ts` (DbProxy — MessageChannel-based for local SQLite), `src/db/direct.ts` (DirectDbHandle — direct libSQL client for remote DB)
- Pattern: Proxy pattern — workers call the same API regardless of DB location; the transport is hidden
- Purpose: Cross-isolate database access for Web Workers when using local SQLite
- Bridge (main thread): `src/db/bridge.ts` — receives named operations via MessagePort, executes against real Client
- Proxy (worker): `src/db/proxy.ts` — sends operations via MessagePort, returns Promises
- Pattern: RPC over MessageChannel with discriminated union allowlist (no arbitrary SQL)
- Purpose: Pre-warmed pool of Deno Workers for concurrent upload I/O + hashing
- Location: `src/workers/pool.ts`
- Pattern: Singleton pool with no queue (returns null when full → 503). Least-loaded routing via throughput heartbeats
- Job dispatch: zero-copy stream transfer via `postMessage` with Transferable
- Purpose: Strongly-typed, validated configuration with sensible defaults
- Location: `src/config/schema.ts`
- Pattern: Zod schemas with `.default()` and `.transform()` — config file can be empty/partial
- Purpose: Typed Hono context variables for auth state propagation
- Location: `src/middleware/auth.ts`
- Contains: `auth` (parsed NostrEvent), `authType` (BUD-11 verb), `authExpiration`
- Pattern: Hono generic `Variables` type — threaded through `Hono<{ Variables: BlossomVariables }>`
## Entry Points
- Location: `/home/robert/Projects/blossom-server/main.ts`
- Triggers: `deno run main.ts [config.yml]`
- Responsibilities: Orchestrates startup sequence — config → DB init → storage init → worker pool init → app build → Deno.serve() → prune loop → graceful shutdown handlers
- Location: `src/server.ts`
- Triggers: Called once by `main.ts`
- Responsibilities: Assembles the Hono app — registers global middleware, mounts landing/admin/blossom sub-apps in correct order
- Location: `src/workers/upload-worker.ts`
- Triggers: Spawned by `UploadWorkerPool` constructor as `new Worker()`
- Responsibilities: Receives init message (DB config), then handles job messages (stream → hash + disk write)
## Error Handling
- Blossom protocol routes use a sub-app `onError` that returns `text/plain` with `X-Reason` header (BUD-01 compliant) — `src/routes/blossom-router.ts`
- Global fallback `onError` preserves `HTTPException.res` (e.g., basicAuth's `WWW-Authenticate`) — `src/middleware/errors.ts`
- Route handlers use `errorResponse()` helper for controlled error responses with specific status codes
- Worker errors are caught per-job and posted back as `{ id, error }` messages
- Prune errors are caught per-blob (loop always completes, never throws)
- Temp file cleanup is always attempted in `catch`/`finally` blocks (`.catch(() => {})` pattern)
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
