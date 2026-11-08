# AGENTS.md — Blossom Server

Guidance for AI coding agents working in this repository.

---

## Project Overview

Blossom Server is a **Deno 2**-based HTTP server implementing the [Blossom](https://github.com/hzrd149/blossom) blob-storage protocol (BUDs
01/02/04/05/06/09/11). It uses **Hono** for routing, **LibSQL** (embedded SQLite) for metadata, and supports local-disk and S3 storage. Authentication is via
BUD-11 Nostr signed events (kind 24242). The admin console uses client-side React with a Hono management API on the main thread, protected by HTTP Basic Auth.

---

## Commands

All commands use the **Deno** toolchain. There is no `package.json`.

```sh
# Development (file-watching)
deno task dev

# Production start
deno task start

# Run the full test suite
deno task test

# Run a single test file
deno test --env-file=.env --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/e2e/upload.test.ts

# Run a single test case by name
deno test --filter "PUT /upload returns 200" --env-file=.env --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/

# Lint (Deno built-in)
deno lint

# Format check
deno fmt --check

# Format (auto-fix)
deno fmt

# Pre-build landing and admin assets (public/client.js, public/styles.css, public/admin/)
# Recommended when the landing page or dashboard is enabled. Missing assets
# produce startup warnings, while blob API routes remain available.
deno task build

# Rebuild all Nix artifacts in sandboxes, bypass cached outputs, and check the flake.
deno task check:nix

# Refresh stale fixed-output hashes, then run the full Nix check
deno task update:nix-hashes

# Individual fixed-output checks, useful when updating a reported hash.
nix build path:.#denoDeps --rebuild --print-build-logs
nix build path:.#clientBundle --rebuild --print-build-logs
nix build path:.#adminBundle --rebuild --print-build-logs
nix build path:.#styles --rebuild --print-build-logs
```

> **Before every commit:** run `deno fmt` to auto-format all changed files. Unformatted code will fail CI. Run `deno fmt --check` to verify without modifying
> files.

> **Changelog:** Add every unreleased user-facing change to the `Unreleased` section of `CHANGELOG.md` as part of the same change. Categorize entries under
> `Major Changes`, `Minor Changes`, or `Patch Changes`, and do not create a new version heading until cutting a release. When releasing, move the accumulated
> entries into the new version section.

> **Read before writing tests:** `TESTING.md` contains the full planned test matrix and helper patterns. Tests go in `tests/unit/` (pure logic) or `tests/e2e/`
> (full Hono app via `app.fetch()` — no real HTTP port needed).

> **Nix deterministic validation (pre-commit only):** When Nix inputs, dependencies, or bundled client code have changed, defer Nix validation and hash
> refreshes until preparing to commit, after all edits are complete. Do not refresh hashes after individual changes or during ongoing development. Before
> committing, run `deno task check:nix`; if it reports a hash mismatch, run `deno task update:nix-hashes` to refresh `nix/package.nix` and verify all outputs.
> These checks realize and force-rebuild `denoDeps`, `clientBundle`, `adminBundle`, `styles`, and the final package so cached outputs cannot hide stale hashes.

### Release development workflow

- Develop each release milestone on a dedicated `v<version>` release-candidate branch, such as `v6.4.1`. Do not implement milestone work directly on `master`.
- Base the release-candidate branch on the current `master`. Every pull request selected for the release must target and merge into that branch, including
  adapted upstream contributions and locally authored milestone work.
- For an existing contribution PR, change its base to `v<version>`, work with the contributor to put any agreed adaptations on that PR's head branch, and merge
  the PR through GitHub. Verify that GitHub marks it **Merged**; copying or cherry-picking its changes into the release branch does not merge the PR. If the
  original PR cannot be updated, open and merge a separate adaptation PR, link the original, and close the original with an explanation after release.
- Use **Create a merge commit** for contribution PRs and the release PR when preserving the contributors' original commit SHAs and authorship in `master` is
  required. Squash merging combines their commits into a new commit, so the individual commits are not retained in `master` history.
- Open a GitHub release pull request from `v<version>` into `master` after the candidate is complete. Use that PR to run the full CI suite and resolve every
  required failure before merge.
- Do not merge the release pull request while required CI checks are failing or pending.
- After the release pull request merges, update local `master`, confirm the merge contains the intended version and changelog, then create and push the
  `v<version>` tag from `master`.
- Publish the Deno package only from the tagged, merged `master` state. Never publish from a release-candidate or contribution branch.
- Preserve traceability from each selected contribution PR to the release-candidate branch, its verification evidence, the release PR, the tag, and the
  published package.

---

## Project Structure

```
blossom-server/
├── main.ts                   # Entry: load config → init DB → init pool → buildApp → Deno.serve
├── deno.json                 # Tasks, import map, compiler options
├── config.example.yml        # Annotated reference config (copy to config.yml to run)
├── ARCHITECTURE.md           # Architecture docs — read before structural changes
├── TESTING.md                # Planned test suite — read before writing tests
├── public/
│   ├── favicon.ico
│   ├── client.js             # Landing page bundle — generated by deno task build
│   └── styles.css            # Compiled Tailwind CSS — generated by deno task build
└── src/
    ├── server.ts             # Hono app assembly: middleware + route routers
    ├── config/
    │   ├── schema.ts         # Zod config schema (all defaults live here)
    │   └── loader.ts         # YAML load + ${ENV_VAR} interpolation + Zod safeParse
    ├── middleware/
    │   ├── auth.ts           # BUD-11 parse, requireAuth(), optionalAuth(), requireXTag()
    │   ├── cors.ts           # BUD-01 CORS
    │   ├── errors.ts         # errorResponse() + global onError handler
    │   ├── debug.ts          # debug() logging helper
    │   └── logger.ts         # requestLogger middleware
    ├── routes/
    │   ├── blobs.ts          # GET/HEAD /:sha256[.ext] (BUD-01)
    │   ├── upload.ts         # PUT /upload, HEAD /upload (BUD-02/06)
    │   ├── delete.ts         # DELETE /:sha256 (BUD-02)
    │   ├── list.ts           # GET /list/:pubkey (BUD-02)
    │   ├── mirror.ts         # PUT /mirror (BUD-04)
    │   ├── media.ts          # PUT /media, HEAD /media (BUD-05)
    │   ├── report.ts         # PUT /report (BUD-09)
    │   └── landing.tsx       # GET /, GET /client.js
    ├── admin/                # Optional management application
    │   ├── server/           # Hono app, API routes, auth, React HTML shell
    │   ├── services/         # Main-thread management operations and DB adapter
    │   ├── contracts/        # Browser-safe API schemas and response types
    │   └── client/           # React console, independent config and bundle
    ├── landing/
    │   ├── client/           # Client-side island (hono/jsx/dom, bundled to public/client.js)
    │   │   ├── index.tsx     # Entry point — hydrates #upload-root
    │   │   ├── App.tsx
    │   │   ├── UploadForm.tsx
    │   │   ├── MirrorForm.tsx
    │   │   └── ...
    │   ├── styles/           # Tailwind input and isolated CLI dependency lock
    │   ├── layout.tsx        # HTML shell + compiled stylesheet link
    │   ├── page.tsx          # LandingPage async SSR component
    │   ├── upload-island.tsx # Island mount point (data-* attrs → client hydration)
    │   ├── server-info.tsx
    │   └── stats-bar.tsx
    ├── storage/
    │   ├── interface.ts      # IBlobStorage + WriteSession interfaces
    │   ├── local.ts          # LocalStorage implementation (Deno FS)
    │   └── s3.ts             # S3Storage implementation
    ├── db/
    │   ├── client.ts         # initDb() / getDb() singleton
    │   ├── blobs.ts          # All SQL query functions
    │   ├── handle.ts         # IDbHandle interface
    │   ├── direct.ts         # DirectDbHandle — wraps @libsql/client Client
    │   ├── bridge.ts         # MessageChannel bridge (upload workers → main thread DB)
    │   └── proxy.ts          # Worker-side DbProxy
    ├── optimize/
    │   ├── index.ts          # optimizeMedia() dispatcher
    │   ├── image.ts          # sharp-based image optimization
    │   └── video.ts          # fluent-ffmpeg video transcoding
    ├── prune/
    │   ├── prune.ts          # Prune loop (removeWhenNoOwners / storage rules)
    │   └── rules.ts          # getFileRule() — per-blob rule evaluation
    ├── utils/
    │   ├── mime.ts           # mimeToExt()
    │   ├── streams.ts        # Stream helpers
    │   └── url.ts            # getBaseUrl(), getBlobUrl()
    └── workers/
        ├── pool.ts           # UploadWorkerPool, initPool(), getPool()
        └── upload-worker.ts  # Single-pass stream → file write + SHA-256
```

> **Route registration order in `server.ts` matters.** `/upload`, `/mirror`, `/media`, `/report`, `/list/:pubkey`, and `/api/*` must be mounted before
> `/:sha256[.ext]` (the blob catch-all). `/admin/*` must be mounted before blob routes too.

---

## Code Style

### TypeScript

- **Strict mode** is on by default in Deno 2 — no explicit `strict: true` needed.
- **ESM only.** All local imports must carry explicit `.ts` / `.tsx` extensions:
  ```ts
  import { requireAuth } from "../middleware/auth.ts"; // correct
  import { requireAuth } from "../middleware/auth"; // wrong — Deno will error
  ```
- **`import type`** for type-only imports:
  ```ts
  import type { Context } from "@hono/hono";
  ```

### Import Map

Bare specifiers are declared in `deno.json`. Use them — do not inline full JSR/npm URLs:

```ts
import { Hono, HTTPException } from "@hono/hono";
import { z } from "zod";
import { verifyEvent } from "nostr-tools/pure";
import { encodeHex } from "@std/encoding/hex";
import { S3Client } from "@bradenmacdonald/s3-lite-client";
```

### Formatting (enforced by `deno fmt`)

- Line width: **120 characters**
- Indentation: **2 spaces** (no tabs)
- Quotes: **double quotes**

### Naming Conventions

| Element                 | Convention                     | Example                               |
| ----------------------- | ------------------------------ | ------------------------------------- |
| Files                   | `kebab-case.ts`                | `upload-worker.ts`                    |
| Exported functions      | `camelCase`                    | `buildUploadRouter`, `requireAuth`    |
| Classes                 | `PascalCase`                   | `LocalStorage`, `S3Storage`           |
| Interfaces              | `PascalCase`                   | `IBlobStorage`, `WriteSession`        |
| Storage interfaces      | `I` prefix                     | `IBlobStorage`                        |
| Zod schemas             | `PascalCase` + `Schema` suffix | `ConfigSchema`, `VideoOptimizeSchema` |
| Constants / regex       | `SCREAMING_SNAKE_CASE`         | `SHA256_RE`, `HEX_PUBKEY_RE`          |
| Module-level singletons | `_underscore` prefix           | `let _pool`, `let _client`            |

### Types and Interfaces

- Prefer **interfaces** for domain shapes (`BlobRecord`, `WriteSession`, `AuthState`).
- **Zod schemas** are the source of truth for config/input types; derive TS types with `z.infer<typeof MySchema>`.
- Use **discriminated unions** for MessageChannel wire types (see `src/db/bridge.ts`).
- Extend Hono context variables via module augmentation (see `src/middleware/auth.ts`).
- Use the **`satisfies`** operator on `postMessage` payloads:
  ```ts
  worker.postMessage({ id, hash, size } satisfies JobRequest);
  ```

---

## Admin UI conventions

- The admin UI uses native React in `src/admin/client/`; its independent Deno configuration owns the JSX runtime.
- Admin styling uses Tailwind CSS 4 and daisyUI 5, configured in `src/admin/styles/input.css` with an isolated Deno config and lockfile. Use daisyUI components
  and semantic colors (`base-100`, `base-content`, `primary`) with Tailwind utilities. Light/dark themes follow the system preference. Run
  `deno task build:admin` for both JS and CSS, or `deno task build:admin:styles` for CSS only. The Nix `adminBundle` contains both assets.
- Hono serves the HTML mount point and authenticated API; components access backend operations through browser-safe API contracts.
- Read the relevant Applesauce examples before implementing any Nostr-specific feature, and follow their established patterns.
- Nostr data uses shared Applesauce instances in `src/admin/client/nostr/`. Use `applesauce-common` casts and `use$` directly, e.g.
  `use$(() => castUser(pubkey, eventStore).profile$, [pubkey])`. Do not wrap Applesauce in a custom client/runtime facade, account helper API, provider, or
  profile hook. Use its native stores, loaders, account classes, React providers, and hooks. TanStack Query owns HTTP admin API data. Do not add backend Nostr
  profile fetching or additional app-wide EventStores/pools. Incoming relay events must enter the shared EventStore. Accounts are session-only and independent
  of HTTP Basic Auth; signer requests require an explicit user action. Trust Applesauce's documented behavior; do not add Nostr client tests that retest the
  library.
- The public landing page continues to use Hono JSX. Do not mix its JSX runtime with the admin React runtime.
- New admin-only DB operations belong in `src/db/` (SQL) and `src/admin/services/database.ts` (main-thread adapter). Do not expand the upload-worker RPC
  interface for admin-only features. Existing methods on `IDbHandle` remain for compatibility until their callers migrate.

---

## Error Handling

- **HTTP errors from route handlers:** `throw new HTTPException(status, { message })` — caught by `onError` in `server.ts`.
- **Route error responses:** `return errorResponse(ctx, status, reason)` — routes always return, never throw.
- **Auth middleware is parse-only** — never throws, always calls `next()`. **Every route must explicitly call `requireAuth()` or `optionalAuth()`** — omitting
  this leaves a route silently unprotected.
- **Body cancellation:** Routes that reject a streaming upload must cancel the body first:
  ```ts
  await ctx.req.raw.body?.cancel();
  return errorResponse(ctx, 400, "reason");
  ```
- **Fire-and-forget async:** use `.catch(() => {})` or `.catch((err) => console.error(...))` for non-critical side effects.
- **Worker errors:** normalize with `err instanceof Error ? err.message : String(err)`.
- **Exhaustive switch:** `const _exhaustive: never = value` in the default branch.

---

## Async Patterns

- **`async/await` throughout** — no raw `.then()` chains except fire-and-forget.
- **Web Streams** (`ReadableStream`, `WritableStream`, `tee()`, `pipeTo()`) for upload handling — never buffer large request bodies.
- **Worker pool:** `pool.dispatch()` returns `null` when all workers are busy → respond 503 immediately.
- **DB singleton:** `getDb()` and `getPool()` throw if called before `initDb()` / `initPool()`. Both are initialized in `main.ts`.

---

## Architecture Constraints

### Admin management application

- `src/admin/server/app.ts` owns the authenticated `/admin` namespace and is dynamically loaded only when enabled. Mount it before public static middleware and
  Blossom protocol middleware. API misses must remain JSON 404s, never frontend HTML.
- The React shell lives at `/admin`; `/admin/console` redirects there. Old SSR pages and profile lookup have been removed. Unregistered admin pages return 404.
- `src/admin/services/` coordinates management operations over the database and storage. HTTP handlers validate input and delegate to these services.
- `src/admin/contracts/` is browser-safe: no imports from database, filesystem, worker, or runtime configuration modules. Return explicit DTOs, never the full
  runtime configuration or resolved credentials.
- `src/admin/client/` uses native React with its own Deno configuration and lockfile. Run `deno task check:admin` and `deno task build:admin` for frontend
  changes. Do not use Hono JSX in this directory or React JSX in SSR pages.
- Admin assets are built into `public/admin/` and served at `/admin/assets/`. Include `adminBundle` in Nix deterministic checks and hash refreshes.
- Configuration is currently deployment-managed and read-only. Persistence, overrides, and hot application require an explicit lifecycle design.
- Legacy user-content deletion force-deletes shared blobs for all owners and processes at most 10,000 records. Preserve this behavior during extraction;
  ownership-only deletion and bounded background jobs are separate feature work.

### Server invariants

1. **No body buffering on rejection.** Cancel the request body before returning any error if streaming may have started.
2. **Worker pool has no queue.** Handle `null` from `dispatch()` as a 503.
3. **Auth middleware never blocks.** Add explicit enforcement in every new route handler.
4. **JSX files** require `.tsx` extension. Server JSX uses Hono; the isolated admin client uses React through its own `deno.json`.
5. **Config uses YAML + Zod**, not `.env`. Env vars inject via `${VAR_NAME}` syntax in `config.yml`.
6. **S3 storage** buffers to a local `tmpDir` before committing — the S3 bucket only ever receives hash-verified blobs.
7. **`fluent-ffmpeg` requires a host `ffmpeg` binary** — not bundled. Video optimization silently fails without it.

---

## Testing Guidelines

```ts
// Unit test skeleton
import { assertEquals } from "@std/assert";
import { myFunction } from "../../src/module.ts";

Deno.test("myFunction does X", () => {
  assertEquals(myFunction(input), expected);
});

// E2E test skeleton — no real HTTP port needed
import { buildApp } from "../../src/server.ts";

Deno.test("PUT /upload returns 200", async () => {
  const app = await buildApp(db, storage, config);
  const res = await app.fetch(
    new Request("http://localhost/upload", { method: "PUT" }),
  );
  assertEquals(res.status, 200);
});
```

- Use `createClient({ url: ":memory:" })` for in-memory DB in unit/e2e tests.
- Use `Deno.makeTempDir()` for filesystem tests; clean up in a `finally` block.
- Generate real Nostr signed events with `generateSecretKey` + `finalizeEvent` from `nostr-tools/pure`.
- Disable `sanitizeOps`/`sanitizeResources` for tests that use the worker pool (ports outlive individual tests by design).
- See `TESTING.md` for the full planned test matrix and helper patterns.
