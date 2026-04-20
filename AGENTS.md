# AGENTS.md — Blossom Server

Guidance for AI coding agents working in this repository.

---

## Project Overview

Blossom Server is a **Deno 2**-based HTTP server implementing the
[Blossom](https://github.com/hzrd149/blossom) blob-storage protocol (BUDs
01/02/04/05/06/09/11). It uses **Hono** for routing, **LibSQL** (embedded
SQLite) for metadata, and supports local-disk and S3 storage. Authentication is
via BUD-11 Nostr signed events (kind 24242). The admin dashboard is server-side
rendered Hono JSX, runs on the main thread, and is protected by HTTP Basic Auth.

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

# Pre-build the landing page client bundle (output: public/client.js)
# Required before running the server when the landing page is enabled.
deno task build
```

> **Before every commit:** run `deno fmt` to auto-format all changed files.
> Unformatted code will fail CI. Run `deno fmt --check` to verify without
> modifying files.

> **Read before writing tests:** `TESTING.md` contains the full planned test
> matrix and helper patterns. Tests go in `tests/unit/` (pure logic) or
> `tests/e2e/` (full Hono app via `app.fetch()` — no real HTTP port needed).

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
│   └── client.js             # Landing page bundle — built at startup or via deno task build
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
    │   ├── admin-router.tsx  # /admin/* SSR pages + action endpoints (main thread)
    │   └── landing.tsx       # GET /, GET /client.js
    ├── admin/                # Admin dashboard SSR components (hono/jsx)
    ├── landing/
    │   ├── client/           # Client-side island (hono/jsx/dom, bundled to public/client.js)
    │   │   ├── index.tsx     # Entry point — hydrates #upload-root
    │   │   ├── App.tsx
    │   │   ├── UploadForm.tsx
    │   │   ├── MirrorForm.tsx
    │   │   └── ...
    │   ├── layout.tsx        # HTML shell + Tailwind CDN
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

> **Route registration order in `server.ts` matters.** `/upload`, `/mirror`,
> `/media`, `/report`, `/list/:pubkey`, and `/api/*` must be mounted before
> `/:sha256[.ext]` (the blob catch-all). `/admin/*` must be mounted before blob
> routes too.

---

## Code Style

### TypeScript

- **Strict mode** is on by default in Deno 2 — no explicit `strict: true`
  needed.
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

Bare specifiers are declared in `deno.json`. Use them — do not inline full
JSR/npm URLs:

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

- Prefer **interfaces** for domain shapes (`BlobRecord`, `WriteSession`,
  `AuthState`).
- **Zod schemas** are the source of truth for config/input types; derive TS
  types with `z.infer<typeof MySchema>`.
- Use **discriminated unions** for MessageChannel wire types (see
  `src/db/bridge.ts`).
- Extend Hono context variables via module augmentation (see
  `src/middleware/auth.ts`).
- Use the **`satisfies`** operator on `postMessage` payloads:
  ```ts
  worker.postMessage({ id, hash, size } satisfies JobRequest);
  ```

---

## Hono JSX (Admin Dashboard Pages)

All admin dashboard pages live in `src/admin/` and are `.tsx` files rendered
server-side using `hono/jsx`.

### Required pragma

Every `.tsx` file must have this pragma as the **first line**:

```tsx
/** @jsxImportSource hono/jsx */
```

This overrides the `deno.json` global `jsxImportSource` at the file level. Do
not omit it — without it, JSX will not compile in worker contexts or may resolve
to the wrong runtime.

### Component typing

Use `FC` from `@hono/hono/jsx` for all function components:

```tsx
import type { FC } from "@hono/hono/jsx";

interface MyProps {
  title: string;
}

export const MyComponent: FC<MyProps> = ({ title }) => <div>{title}</div>;
```

### Async components

`hono/jsx` supports async components natively — no wrappers needed. `c.html()`
awaits them automatically:

```tsx
export const MyPage: FC<Props> = async ({ db, id }) => {
  const record = await db.getRecord(id);
  return <div>{record.name}</div>;
};

// In the route handler:
app.get("/admin/foo/:id", (c) => {
  return c.html(<MyPage db={dbHandle} id={c.req.param("id")} />);
});
```

### Fragments

Use `<></>` shorthand (configured via `deno.json`):

```tsx
const List = () => (
  <>
    <p>first</p>
    <p>second</p>
  </>
);
```

### Admin page conventions

- All pages import shared UI primitives from `./layout.tsx` (`AdminLayout`,
  `Table`, `Badge`, `PageHeader`, `Pagination`, etc.)
- `AdminLayout` takes `section: "blobs" | "users" | "rules" | "reports"` to
  highlight the active nav item
- DB access is via `IDbHandle` (passed as a prop); the router builds a
  `DirectDbHandle` wrapping the raw `Client`
- `DirectDbHandle` is in `src/db/direct.ts` — it wraps the real `@libsql/client`
  Client and implements every `IDbHandle` method
- New admin DB operations must be added to: `src/db/blobs.ts` (SQL),
  `src/db/handle.ts` (interface), `src/db/direct.ts` (direct impl),
  `src/db/proxy.ts` (proxy for upload workers), and `src/db/bridge.ts` (bridge
  discriminated union + switch case)
- `DirectDbHandle` is in `src/db/direct.ts` — it wraps the real `@libsql/client`
  Client and implements every `IDbHandle` method

---

## Error Handling

- **HTTP errors from route handlers:**
  `throw new HTTPException(status, { message })` — caught by `onError` in
  `server.ts`.
- **Route error responses:** `return errorResponse(ctx, status, reason)` —
  routes always return, never throw.
- **Auth middleware is parse-only** — never throws, always calls `next()`.
  **Every route must explicitly call `requireAuth()` or `optionalAuth()`** —
  omitting this leaves a route silently unprotected.
- **Body cancellation:** Routes that reject a streaming upload must cancel the
  body first:
  ```ts
  await ctx.req.raw.body?.cancel();
  return errorResponse(ctx, 400, "reason");
  ```
- **Fire-and-forget async:** use `.catch(() => {})` or
  `.catch((err) => console.error(...))` for non-critical side effects.
- **Worker errors:** normalize with
  `err instanceof Error ? err.message : String(err)`.
- **Exhaustive switch:** `const _exhaustive: never = value` in the default
  branch.

---

## Async Patterns

- **`async/await` throughout** — no raw `.then()` chains except fire-and-forget.
- **Web Streams** (`ReadableStream`, `WritableStream`, `tee()`, `pipeTo()`) for
  upload handling — never buffer large request bodies.
- **Worker pool:** `pool.dispatch()` returns `null` when all workers are busy →
  respond 503 immediately.
- **DB singleton:** `getDb()` and `getPool()` throw if called before `initDb()`
  / `initPool()`. Both are initialized in `main.ts`.

---

## Architecture Constraints

1. **No body buffering on rejection.** Cancel the request body before returning
   any error if streaming may have started.
2. **Worker pool has no queue.** Handle `null` from `dispatch()` as a 503.
3. **Auth middleware never blocks.** Add explicit enforcement in every new route
   handler.
4. **JSX files** require `.tsx` extension and the `hono/jsx` import source (set
   globally in `deno.json`).
5. **Config uses YAML + Zod**, not `.env`. Env vars inject via `${VAR_NAME}`
   syntax in `config.yml`.
6. **S3 storage** buffers to a local `tmpDir` before committing — the S3 bucket
   only ever receives hash-verified blobs.
7. **`fluent-ffmpeg` requires a host `ffmpeg` binary** — not bundled. Video
   optimization silently fails without it.

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
- Generate real Nostr signed events with `generateSecretKey` + `finalizeEvent`
  from `nostr-tools/pure`.
- Disable `sanitizeOps`/`sanitizeResources` for tests that use the worker pool
  (ports outlive individual tests by design).
- See `TESTING.md` for the full planned test matrix and helper patterns.
