# AGENTS.md — Blossom Server

Guidance for AI coding agents working in this repository.

---

## Project Overview

Blossom Server is a **Deno 2**-based HTTP server implementing the
[Blossom](https://github.com/hzrd149/blossom) blob-storage protocol (BUDs
01/02/06/11). It uses **Hono** for routing, **LibSQL** (embedded SQLite) for
metadata, and supports local-disk storage. Authentication is via BUD-11 Nostr
signed events (kind 24242).

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
deno test --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/unit/auth.test.ts

# Run a single test case by name
deno test --filter "parseAuthEvent valid event" --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/

# Lint (Deno built-in)
deno lint

# Format check
deno fmt --check

# Format (auto-fix)
deno fmt

# Build browser bundle (landing page)
deno task bundle
```

> **Note:** No tests exist yet. `TESTING.md` contains the full planned test
> suite layout and helper patterns.

---

## Project Structure

```
blossom-server/
├── main.ts                   # Entry: load config → init DB → init pool → buildApp → Deno.serve
├── deno.json                 # Tasks, import map, compiler options
├── config.example.yml        # Annotated reference config (copy to config.yml to run)
├── ARCHITECTURE.md           # Architecture documentation — read before making structural changes
├── TESTING.md                # Planned test suite — read before writing tests
├── blossom/                  # Git submodule: BUD spec reference (read-only)
└── src/
    ├── server.ts             # Hono app assembly: middleware + route routers
    ├── config/
    │   ├── schema.ts         # Zod config schema (all defaults live here)
    │   └── loader.ts         # YAML load + ${ENV_VAR} interpolation + Zod safeParse
    ├── middleware/
    │   ├── auth.ts           # BUD-11 parse, requireAuth(), optionalAuth(), requireXTag()
    │   ├── cors.ts           # BUD-01 CORS
    │   └── errors.ts         # errorResponse() + global onError handler
    ├── routes/
    │   ├── blobs.ts          # GET/HEAD /:sha256[.ext] (BUD-01)
    │   ├── upload.ts         # PUT /upload, HEAD /upload (BUD-02/06)
    │   ├── delete.ts         # DELETE /:sha256 (BUD-02)
    │   ├── list.ts           # GET /list/:pubkey (BUD-02)
    │   └── landing.ts        # GET / (proxies to landing worker)
    ├── storage/
    │   ├── interface.ts      # IBlobStorage + WriteSession interfaces
    │   └── local.ts          # LocalStorage implementation (Deno FS)
    ├── db/
    │   ├── client.ts         # initDb() / getDb() singleton
    │   ├── blobs.ts          # All SQL query functions
    │   ├── bridge.ts         # Main-thread DB bridge over MessageChannel
    │   └── proxy.ts          # Worker-side DbProxy
    ├── workers/
    │   ├── pool.ts           # UploadWorkerPool, initPool(), getPool()
    │   ├── upload-worker.ts  # Single-pass stream → file write + SHA-256
    │   └── landing-worker.tsx
    └── landing/              # SSR landing page components (Hono JSX)
```

---

## Code Style

### TypeScript

- **Strict mode** is enabled by default in Deno 2 — no need for explicit
  `strict: true`.
- **ESM only.** All imports must use explicit `.ts` or `.tsx` file extensions:
  ```ts
  import { requireAuth } from "../middleware/auth.ts"; // correct
  import { requireAuth } from "../middleware/auth"; // wrong — Deno will error
  ```
- **`import type`** must be used for type-only imports:
  ```ts
  import type { Context } from "@hono/hono";
  ```

### Import Map

Dependencies are declared in `deno.json` as bare specifiers. Use the existing
specifiers:

```ts
import { Hono, HTTPException } from "@hono/hono";
import { z } from "zod";
import { verifyEvent } from "nostr-tools/pure";
import { encodeHex } from "@std/encoding/hex";
```

Cross-module imports within `src/` use relative paths with explicit extensions.

### Formatting

Enforced by `deno fmt` (run before committing):

- **Line width:** 120 characters
- **Indentation:** 2 spaces (no tabs)
- **Quotes:** double quotes (Deno fmt default)

### Naming Conventions

| Element                 | Convention                     | Example                                      |
| ----------------------- | ------------------------------ | -------------------------------------------- |
| Files                   | `kebab-case.ts`                | `upload-worker.ts`                           |
| Exported functions      | `camelCase`                    | `buildUploadRouter`, `requireAuth`           |
| Classes                 | `PascalCase`                   | `LocalStorage`, `UploadWorkerPool`           |
| Interfaces              | `PascalCase`                   | `IBlobStorage`, `WriteSession`, `BlobRecord` |
| Storage interfaces      | `I` prefix                     | `IBlobStorage`                               |
| Zod schemas             | `PascalCase` + `Schema` suffix | `ConfigSchema`, `StorageRuleSchema`          |
| Constants / regex       | `SCREAMING_SNAKE_CASE`         | `SHA256_RE`, `HEX_PUBKEY_RE`                 |
| Module-level singletons | `_underscore` prefix           | `let _pool`, `let _client`                   |

### Types and Interfaces

- Prefer **interfaces** for domain shapes: `BlobRecord`, `WriteSession`,
  `AuthState`.
- Prefer **Zod schemas** as the source of truth for config/input types; derive
  the TS type with `z.infer<typeof MySchema>`.
- Use **discriminated unions** for MessageChannel wire types (see
  `src/db/bridge.ts`).
- Extend Hono context variables via module augmentation (see
  `src/middleware/auth.ts`).
- Use the **`satisfies`** operator on `postMessage` payloads for compile-time
  wire type safety:
  ```ts
  worker.postMessage({ id, hash, size } satisfies JobRequest);
  ```

---

## Error Handling

- **HTTP errors:** `throw new HTTPException(status, { message })` from route
  handlers. Caught by the global `onError` in `src/server.ts`.
- **Route error responses:** `return errorResponse(ctx, status, reason)` —
  routes always return; they don't throw.
- **Auth middleware is parse-only** — it never throws or blocks. It populates
  `ctx.var.auth` if a valid header is present and always calls `next()`. **Every
  route must explicitly call `requireAuth()` or `optionalAuth()`** — a new route
  without this call is silently unprotected.
- **Fire-and-forget async:** use `.catch(() => {})` or
  `.catch((err) => console.error(...))` for non-critical side effects (e.g.,
  `touchBlob`, temp-file cleanup).
- **Worker error normalization:**
  `err instanceof Error ? err.message : String(err)`.
- **Exhaustive switch:** use `const _exhaustive: never = value` in switch
  default to catch unhandled cases at compile time.
- **Body cancellation:** Routes that reject a streaming upload must cancel the
  request body before returning:
  ```ts
  await ctx.req.raw.body?.cancel();
  return errorResponse(ctx, 400, "reason");
  ```

---

## Async Patterns

- **`async/await` throughout** — no raw `.then()` chains except for
  fire-and-forget.
- **Web Streams** (`ReadableStream`, `WritableStream`, `TransformStream`,
  `tee()`, `pipeTo()`) are used for upload handling — do not buffer large
  request bodies.
- **Worker pool:** `pool.dispatch()` returns `null` when all workers are busy.
  The route must handle `null` → respond with 503 immediately.
- **DB singleton:** `getDb()` and `getPool()` throw if called before `initDb()`
  / `initPool()`. Both are initialized in `main.ts` before `buildApp()`.

---

## Architecture Constraints

1. **No body buffering on rejection.** If the request body may have started
   streaming, cancel it before returning an error.
2. **Worker pool has no queue.** Callers must handle a `null` return from
   `dispatch()` as a 503.
3. **Auth middleware never blocks.** Always add explicit auth enforcement in new
   route handlers.
4. **JSX files** must use the `.tsx` extension and the `hono/jsx` import source
   (set globally in `deno.json`).
5. **Config uses YAML + Zod**, not `.env` files. Env vars are injected via
   `${VAR_NAME}` syntax inside `config.yml`.

---

## Testing Guidelines

Tests go in `tests/unit/` (pure logic) or `tests/e2e/` (full Hono app via
`app.fetch()`).

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
  const app = buildApp(config, db, storage, pool);
  const res = await app.fetch(new Request("http://localhost/upload", { method: "PUT", ... }));
  assertEquals(res.status, 200);
});
```

- Use `createClient({ url: ":memory:" })` for in-memory DB in unit tests.
- Use `Deno.makeTempDir()` for filesystem tests; clean up in a `finally` block.
- Generate real Nostr signed events with `generateSecretKey` + `finalizeEvent`
  from `nostr-tools/pure`.
- See `TESTING.md` for the full planned test matrix and helper patterns.
