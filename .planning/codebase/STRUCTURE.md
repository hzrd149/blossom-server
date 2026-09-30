# Codebase Structure

**Analysis Date:** 2026-09-30

## Directory Layout

```text
blossom-server/
├── main.ts                    # Runtime bootstrap and process lifecycle
├── deno.json                  # Deno tasks, import map, compiler settings
├── config.example.yml         # Annotated YAML configuration reference
├── public/                    # Static assets and generated landing bundles
├── src/
│   ├── admin/                 # Server-rendered admin dashboard pages
│   ├── config/                # Zod schema and YAML configuration loader
│   ├── db/                    # SQL operations, clients, handles, migrations
│   ├── landing/               # SSR landing page and browser client island
│   ├── middleware/            # Hono request middleware and error helpers
│   ├── optimize/              # Media optimization and thumbnail processing
│   ├── prune/                 # Retention rule evaluation and prune loop
│   ├── routes/                # Blossom, admin, and landing route builders
│   ├── storage/               # Blob storage interface and adapters
│   ├── utils/                 # Shared stream, URL, MIME, auth data helpers
│   └── workers/               # Upload worker pool and worker implementation
├── tests/
│   ├── e2e/                   # Hono app request/response coverage
│   └── unit/                  # Pure logic and adapter tests
├── scripts/                   # Nix validation/hash maintenance scripts
└── nix/                       # Nix package, module, and VM examples
```

## Directory Purposes

**`src/routes/`:**

- Purpose: Blossom protocol endpoints and Hono sub-app composition.
- Contains: `build*Router` functions for upload, media, mirror, report, list, delete, blob reads, admin, and landing.
- Key files: `src/routes/blossom-router.ts`, `src/routes/upload.ts`, `src/routes/admin-router.tsx`.

**`src/db/`:**

- Purpose: Persist blob metadata, ownership, reports, media relationships, and admin query data.
- Contains: SQL helper modules, LibSQL client lifecycle, handle implementations, worker bridge/proxy, ordered SQL migrations.
- Key files: `src/db/blobs.ts`, `src/db/reports.ts`, `src/db/handle.ts`, `src/db/migrations/`.

**`src/storage/`:**

- Purpose: Encapsulate physical blob access and two-phase writes.
- Contains: `IBlobStorage`/`WriteSession` contracts and local/S3 adapters.
- Key files: `src/storage/interface.ts`, `src/storage/local.ts`, `src/storage/s3.ts`.

**`src/workers/`:**

- Purpose: Stream uploads to temporary files and compute their content hash in worker isolates.
- Contains: Worker pool, worker message handling, concurrency and throughput selection.
- Key files: `src/workers/pool.ts`, `src/workers/upload-worker.ts`.

**`src/middleware/`:**

- Purpose: Cross-cutting Hono request processing.
- Contains: Auth parsing, CORS, errors, request logging, and debug logging.
- Key files: `src/middleware/auth.ts`, `src/middleware/errors.ts`.

**`src/config/`:**

- Purpose: Define and load runtime settings.
- Contains: Zod schemas/defaults and YAML/env interpolation.
- Key files: `src/config/schema.ts`, `src/config/loader.ts`.

**`src/landing/`:**

- Purpose: Optional landing UI with server-side rendering and client hydration.
- Contains: JSX layout/page components, an upload island, browser-side client modules, and isolated build configuration/lockfiles.
- Key files: `src/landing/page.tsx`, `src/landing/upload-island.tsx`, `src/landing/client/index.tsx`, `src/landing/styles/input.css`.

**`src/admin/`:**

- Purpose: Optional authenticated server-rendered dashboard.
- Contains: Blob/user/rule/report pages and Nostr profile lookups.
- Key files: `src/admin/layout.tsx`, `src/admin/blobs-page.tsx`, `src/admin/nostr-profile.ts`.

**`src/optimize/` and `src/prune/`:**

- Purpose: Media transformations and policy-based cleanup.
- Contains: Image/video processing, dimensions, thumbnails, rule matching, and bounded prune scans.
- Key files: `src/optimize/index.ts`, `src/optimize/thumbnail.ts`, `src/prune/prune.ts`, `src/prune/rules.ts`.

**`src/utils/`:**

- Purpose: Shared helpers used across route and domain modules.
- Contains: Streaming guards, MIME/URL helpers, IP guard, and NIP-94 tags.
- Key files: `src/utils/streams.ts`, `src/utils/mime.ts`, `src/utils/url.ts`.

**`tests/`:**

- Purpose: Validate pure behavior and HTTP flows without opening a network listener.
- Contains: `tests/unit/` and `tests/e2e/`; E2E cases invoke Hono via `app.fetch()`.
- Key files: `tests/e2e/upload.test.ts`, `tests/unit/prune.test.ts`.

**`public/`, `nix/`, and `scripts/`:**

- Purpose: Static/generated assets and packaging/maintenance support.
- Contains: `public/favicon.ico` plus generated `client.js`/`styles.css`; Nix package/module/VM files; shell scripts for deterministic Nix validation and hash
  updates.
- Key files: `flake.nix`, `nix/package.nix`, `nix/module.nix`, `scripts/nix-check.sh`, `scripts/nix-update-hashes.sh`.

## Key File Locations

**Entry Points:**

- `main.ts`: executable startup, initialization, scheduling, serving, and shutdown.
- `src/server.ts`: Hono app factory used by runtime and tests.
- `src/landing/client/index.tsx`: browser client bundle entry point.

**Configuration:**

- `deno.json`: tasks, imports, compiler/JSX settings, permissions.
- `config.example.yml`: reference runtime YAML configuration.
- `src/config/schema.ts`: canonical fields and defaults.
- `src/config/loader.ts`: config file loading and environment interpolation.

**Core Logic:**

- `src/routes/`: protocol request handlers.
- `src/db/blobs.ts` and `src/db/reports.ts`: named SQL operations.
- `src/storage/interface.ts`: storage contract.
- `src/workers/pool.ts`: upload dispatch and worker lifecycle.
- `src/prune/prune.ts`: periodic deletion flow.

**Testing:**

- `tests/unit/`: unit tests for configuration, auth, stream/range handling, storage, and pruning.
- `tests/e2e/`: route tests against a built Hono app.
- `src/landing/client/identity.test.ts`: browser-client utility test with client-specific Deno config.

## Naming Conventions

**Files:**

- Lowercase `kebab-case` with `.ts` for logic and `.tsx` for JSX, for example `upload-worker.ts` and `admin-router.tsx`.
- Test files end in `.test.ts`, for example `tests/e2e/upload.test.ts`.
- SQL migrations use numeric prefixes and descriptive `snake_case`, for example `src/db/migrations/003_reports.sql`.

**Directories:**

- Lowercase descriptive names, generally grouped by responsibility (`src/routes/`, `src/storage/`, `src/workers/`).
- Tests are separated into `unit/` and `e2e/` beneath `tests/`.

## Where to Add New Code

**New protocol endpoint:**

- Primary code: add `src/routes/<endpoint>.ts` with a `build<Endpoint>Router(...)` factory.
- Registration: mount it in the correct position in `src/routes/blossom-router.ts`; specific paths precede the blob catch-all.
- Tests: add request/response coverage under `tests/e2e/` and pure validation tests under `tests/unit/` when appropriate.

**New admin page:**

- Page component: `src/admin/<name>-page.tsx`.
- Route and actions: `src/routes/admin-router.tsx`.
- Shared visual primitives: `src/admin/layout.tsx`.

**New landing UI:**

- Server-rendered content: `src/landing/`.
- Interactive browser components: `src/landing/client/`.
- Rebuild outputs with `deno task build`; generated assets go to `public/`.

**New database operation:**

- SQL implementation: `src/db/blobs.ts` or `src/db/reports.ts`.
- If callable through `IDbHandle` in workers, update `src/db/handle.ts`, `src/db/direct.ts`, `src/db/proxy.ts`, and the discriminated request/dispatch in
  `src/db/bridge.ts`.
- Schema changes: add a numerically prefixed migration under `src/db/migrations/`.

**New storage backend or storage capability:**

- Contract: `src/storage/interface.ts`.
- Implement all relevant operations in each concrete adapter under `src/storage/`.
- Adapter tests belong in `tests/unit/`.

**Shared utility or middleware:**

- Utilities: `src/utils/`, named for the domain concern.
- Hono cross-cutting middleware: `src/middleware/`, then register in `src/server.ts` when global.

## Special Directories

**`src/landing/client/`:**

- Purpose: Browser-only hydrated upload/mirror application.
- Generated: No source files are generated; its bundled output is `public/client.js`.
- Committed: Source and isolated lock/config files are repository code; the client bundle is build output.

**`src/landing/styles/`:**

- Purpose: Tailwind input and isolated CLI dependency configuration.
- Generated: `public/styles.css` is generated from `input.css` and scanned source files.
- Committed: Input, config, and lockfile are source; CSS output is build output.

**`src/db/migrations/`:**

- Purpose: Ordered SQL schema evolution applied by `src/db/client.ts` at startup.
- Generated: No.
- Committed: Yes; add a new numeric migration instead of editing deployed history.

**`public/`:**

- Purpose: Files served statically by the Hono app.
- Generated: `client.js` and `styles.css` are generated by build tasks; favicon is static.
- Committed: Static assets and generated bundles may be present in the repository/build output; regenerate bundles with `deno task build` after UI changes.

**`.planning/codebase/`:**

- Purpose: GSD reference maps consumed by planning and execution workflows.
- Generated: Written by codebase mapping workflows.
- Committed: Planning artifacts are repository documents.

---

_Structure analysis: 2026-09-30_
