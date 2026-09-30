# Testing Patterns

**Analysis Date:** 2026-09-30

## Test Framework

**Runner:**

- Deno built-in test runner (Deno 2); test configuration and tasks are in `deno.json`.
- No third-party test runner config is present.

**Assertion Library:**

- `@std/assert` (`assertEquals`, `assertMatch`, `assertThrows`, `assertRejects`, and related helpers).

**Run Commands:**

```bash
deno task test                         # unit + e2e suites, then client identity test
deno test -P --env-file=.env tests/unit/ tests/e2e/  # server-side suites
deno task test:client                  # client identity test with its isolated config/lock
deno test --filter "parseRange" tests/unit/ # focused test selection
deno lint                              # static lint
deno fmt --check                       # formatting check
```

Tests that load the application config need `.env` available as the task specifies. Tests use temporary resources for filesystem/DB integration.

## Test File Organization

**Location:**

- Pure helpers, config, storage behavior, protocol parsing, and DB-backed logic belong in `tests/unit/`.
- Full route behavior uses Hono's `app.fetch()` in `tests/e2e/`; no listening HTTP port is needed.
- Landing client behavior currently has a separate test at `src/landing/client/identity.test.ts`, run with the isolated `src/landing/client/deno.json` and
  lockfile.

**Naming:**

- Name files `<area>.test.ts`, with test descriptions naming the function or HTTP method/path and expected behavior.

**Structure:**

```text
tests/
├── unit/      # pure logic and focused component tests
└── e2e/       # complete Hono routes through app.fetch()
src/landing/client/identity.test.ts
```

## Test Structure

**Suite Organization:**

```typescript
import { assertEquals } from "@std/assert";
import { getBaseUrl } from "../../src/utils/url.ts";

Deno.test("getBaseUrl: no proxy headers — uses connection scheme", () => {
  const req = new Request("http://localhost:3000/");
  assertEquals(getBaseUrl(req, ""), "http://localhost:3000");
});
```

**Patterns:**

- Prefer descriptive standalone `Deno.test()` cases; use a small local helper for repeated setup/data builders, as in `tests/unit/auth.test.ts`.
- For async errors, use `await assertRejects(...)`; for synchronous throws, use `assertThrows(...)` and check the error type/message.
- For filesystem tests, create a `Deno.makeTempDir()` and clean it in `finally`, including best-effort cleanup where partial setup is possible
  (`tests/unit/config.test.ts`, `tests/unit/local-storage.test.ts`).
- For LibSQL unit tests use `createClient({ url: ":memory:" })` and close the client after use (`tests/unit/media-derivative.test.ts`).
- Keep tests deterministic: generate actual signed Nostr events using `generateSecretKey()` and `finalizeEvent()` instead of mocking signature verification.

## Mocking

**Framework:** No general mocking framework is used. Deno APIs and native platform objects are used directly; tests occasionally replace a console method or
inject a fetch/DNS dependency when the unit under test exposes that seam.

**Patterns:**

```typescript
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
try {
  // exercise behavior
} finally {
  console.warn = originalWarn;
}
```

**What to Mock:**

- Replace only external boundaries that the module makes injectable (for example, fetch or resolver callbacks) when testing failure paths.
- Stub global console methods only when asserting warnings, and always restore them in `finally`.

**What NOT to Mock:**

- Do not mock Hono for route tests; build the real app and call `app.fetch()`.
- Prefer in-memory LibSQL, temp directories, and valid signed Nostr events over mocks for storage, DB, and auth integration.

## Fixtures and Factories

**Test Data:**

```typescript
const sk = generateSecretKey();
const event = finalizeEvent({
  kind: 24242,
  created_at: Math.floor(Date.now() / 1000),
  tags: [["t", "upload"], ["expiration", String(Date.now() / 1000 + 600)]],
  content: "Upload blob",
}, sk);
```

**Location:**

- Keep small test-specific helpers near their tests, e.g. auth builders in `tests/unit/auth.test.ts` and `tests/e2e/upload.test.ts`.
- Shared behavior should be extracted only when there is an established helper module need; no global fixture directory is present.

## Coverage

**Requirements:** No coverage target or coverage task is configured in `deno.json`.

**View Coverage:**

```bash
deno test --coverage=coverage tests/unit/ tests/e2e/
deno coverage coverage
```

## Test Types

**Unit Tests:**

- Exercise pure utility behavior, input validation, parsers, configuration defaults, local storage, and focused DB operations.
- Cover boundary and malformed inputs as well as success paths; examples include `tests/unit/range.test.ts`, `tests/unit/ip-guard.test.ts`, and
  `tests/unit/config.test.ts`.

**Integration / E2E Tests:**

- Construct `buildApp(db, storage, config)` with real LibSQL and local storage, then send `Request` objects through `app.fetch()`.
- Use temporary directories and real protocol inputs. Upload-related route tests may share a server and worker pool within a file to avoid singleton conflicts.
- Worker MessagePorts can outlive an individual test. In those files, disable `sanitizeOps` and `sanitizeResources` on setup and dependent tests, and shut down
  the pool / close the DB / remove temp files in cleanup.
- Consume or cancel response bodies to release stream resources. For streaming request rejection cases, verify cancellation behavior where relevant.

**E2E Tests:**

- No browser or external-port E2E framework is used; Hono's in-process fetch path is the end-to-end boundary.

## Common Patterns

**Async Testing:**

```typescript
Deno.test("loadConfigStrict: valid file loads", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // arrange, await operation, assert result
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
```

**Error Testing:**

```typescript
await assertRejects(
  () => loadConfigStrict(missingPath, true),
  MissingConfigError,
  "not found",
);
```

---

_Testing analysis: 2026-09-30_
