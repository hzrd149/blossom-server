# Testing

## Framework

- **Runner:** Deno test (built-in)
- **Assertions:** `@std/assert` (assertEquals, assertThrows, etc.)

## Test Commands

```bash
deno test --env-file=.env --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/unit/ tests/e2e/
```

## Structure

- **Unit tests:** `tests/unit/` (e.g., `auth.test.ts`, `range.test.ts`) - test single functions
- **E2E tests:** `tests/e2e/` (e.g., `upload.test.ts`, `blobs.test.ts`) - run against real app with real DB/storage

## Test Patterns

- Tests use `Deno.test()` with named tests and options
- E2E tests disable `sanitizeOps` and `sanitizeResources` for persistent resources like MessagePorts
- Shared app/server instance built once and reused across tests to avoid singleton conflicts (worker pools)

## Test Helpers

- **Factories:** `makeEvent()` for generating valid Nostr events
- **Encoding:** `encodeAuth()` for auth token generation
- **Assertions:** `assertBlobUrl()` for custom assertion wrappers

## Fixtures

- Generate valid Nostr events with `finalizeEvent()` and real crypto (`@std/crypto`)
- Real temporary directories via `Deno.makeTempDir()`
- Real Nostr events signed with real keys

## Mocking Strategy

- Minimal mocking - prefer real implementations
- Real Nostr events signed with real keys
- Real temporary DB/storage backends
- Real HTTP requests via `app.fetch()`

## Coverage

- No formal coverage requirements detected
- Tests are comprehensive with edge cases (e.g., `extractHostname` null/undefined/URLs, range parsing boundaries)
