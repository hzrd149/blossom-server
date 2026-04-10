---
phase: 03-media-endpoints-and-error-format
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/routes/media.ts
  - tests/e2e/media.test.ts
  - tests/e2e/x-reason.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-04-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Three files were reviewed: the `PUT /media` and `HEAD /media` route handler (`src/routes/media.ts`), and two E2E test suites (`tests/e2e/media.test.ts`, `tests/e2e/x-reason.test.ts`).

`media.ts` is a well-structured, carefully documented route handler. The multi-step upload pipeline is clearly annotated, temp file cleanup is thorough, and the deduplication paths are correct. However, several behavioural edge cases and logic issues are worth fixing before the phase is considered done.

The two test files provide solid coverage of status codes and X-Reason header presence, but they have gaps (no happy-path 200 test for `PUT /media`, no auth-enforced coverage) and a non-determinism risk in the shared-state setup pattern.

---

## Warnings

### WR-01: `HEAD /media` handler registered as `GET` — HEAD requests bypass auth and pool checks on some Hono versions

**File:** `src/routes/media.ts:142`
**Issue:** The handler is registered with `app.get("/media", ...)` and relies on Hono automatically stripping the body for `HEAD` requests. However, Hono's HEAD-auto-promotion from GET routes only works when the framework is configured to do so. More importantly, the GET handler returns `ctx.body(null, 200)` at line 211, which is the correct terminal response for HEAD — but it short-circuits through all the guard checks. This means a HEAD request can reach the pool check and MIME check, but if the Hono version does NOT auto-promote `GET` to `HEAD`, the `HEAD /media` route will fall through to a 404.

The Hono 4.x docs confirm that HEAD is automatically handled by GET routes, but this implicit behaviour is fragile and not obvious. The existing comment on line 141 acknowledges the workaround. No bug today, but it is worth registering an explicit `.on(["GET", "HEAD"], ...)` to be defensive.

**Fix:**
```typescript
// Replace:
app.get("/media", (ctx) => { ... });

// With:
app.on(["GET", "HEAD"], "/media", (ctx) => { ... });
```

---

### WR-02: Auth x-tag check skipped entirely when `requireAuth` is false and no auth header is sent

**File:** `src/routes/media.ts:393`
**Issue:** The x-tag validation block (step 10) is guarded by `if (auth)`. When `config.media.requireAuth` is `false` AND the client sends no Authorization header, `auth` is `undefined` and the entire x-tag check is bypassed. Per the BUD-05 comment at the top of the file: "x-tag verification is STRICT and POST-BODY (original hash must be in x tags)". If this requirement is unconditional (i.e., required whenever an auth token IS present), the current code is correct. But if the spec intends x-tags to be required regardless of server auth policy, the guard is wrong.

The current code means that an unauthenticated upload (no auth header) to a server with `requireAuth: false` bypasses x-tag verification entirely, allowing any content to be stored under any optimization path without any hash binding.

**Fix:** If x-tags are only required when auth is present, document the spec intent explicitly in the block comment to prevent future regression. If x-tags must be required unconditionally, restructure:
```typescript
// If auth event is present, enforce x-tag binding
if (auth) {
  const xTags = auth.tags.filter((t) => t[0] === "x");
  if (xTags.length === 0) { ... }
  if (!xTags.some((t) => t[1] === originalHash)) { ... }
}
// If no auth and requireAuth=false: anonymous uploads skip x-tag check (by design)
```
Either clarify the intent or add a comment explicitly stating that anonymous uploads intentionally bypass x-tag validation.

---

### WR-03: Dedup return path at step 11 (derivative exists, blob pruned) falls through to re-optimize without removing the stale `media_derivatives` record

**File:** `src/routes/media.ts:449`
**Issue:** At line 449, the comment says "Derivative record exists but blob was pruned — fall through to re-optimize." This is logically correct for the re-optimization path, but the stale `media_derivatives` record is never removed before inserting a new one at step 18. If `originalHash` maps to a pruned `existingOptimizedHash`, and the re-optimization produces a new `optimizedHash` (possibly identical to the old one, but possibly different), `insertMediaDerivative(db, originalHash, optimizedHash)` at line 553 will insert a second row. Depending on the DB schema (UNIQUE constraint or upsert), this either silently fails (no-op) or creates a duplicate.

This is also a latent data integrity issue: the next call to `getMediaDerivative(db, originalHash)` after the re-optimize will return whichever row the DB considers first.

**Fix:** Before falling through to step 12, delete the stale derivative record:
```typescript
// Derivative record exists but blob was pruned — clear stale mapping and re-optimize
await deleteMediaDerivative(db, originalHash); // new DB helper needed
// fall through to step 12
```
Or verify that `insertMediaDerivative` is an upsert (INSERT OR REPLACE) so re-insertion is idempotent.

---

### WR-04: `hashFile` does not close the file handle on error

**File:** `src/routes/media.ts:89-113`
**Issue:** `hashFile` opens a file with `Deno.open()` and pipes its readable stream. If `Promise.all` rejects (e.g., the digest fails mid-stream), the file handle obtained on line 92 is not explicitly closed. `file.readable` is a `ReadableStream` and calling `tee()` on it does not guarantee the underlying resource is released on rejection. In Deno, file descriptors are limited; under high concurrency or repeated failures this leaks file descriptors.

**Fix:**
```typescript
async function hashFile(filePath: string): Promise<{ hash: string; size: number }> {
  const file = await Deno.open(filePath, { read: true });
  try {
    const [s1, s2] = file.readable.tee();
    let size = 0;
    const countingTransform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const [hashBuf] = await Promise.all([
      stdCrypto.subtle.digest("SHA-256", s1 as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>),
      s2.pipeThrough(countingTransform).pipeTo(new WritableStream()),
    ]);
    return { hash: encodeHex(new Uint8Array(hashBuf)), size };
  } catch (err) {
    file.close();
    throw err;
  }
}
```
Note: once `file.readable` is consumed by the streams, calling `file.close()` in the success path is typically not needed (stream consumption closes the file), but the error path must close explicitly.

---

## Info

### IN-01: Duplicate import of `@std/media-types` — two named imports on separate lines

**File:** `src/routes/media.ts:40-41`
**Issue:** The same module `@std/media-types` is imported twice on adjacent lines:
```typescript
import { typeByExtension } from "@std/media-types";
import { extension as extFromMime } from "@std/media-types";
```
These can be combined into a single import statement, which is idiomatic TypeScript/Deno style and follows the project's import conventions.

**Fix:**
```typescript
import { extension as extFromMime, typeByExtension } from "@std/media-types";
```

---

### IN-02: No happy-path `PUT /media` test (successful 200 response with real PNG)

**File:** `tests/e2e/media.test.ts`
**Issue:** All `PUT /media` test cases exercise error paths (409, 413, 415). There is no test that verifies a successful upload returns 200 with a valid `BlobDescriptor` JSON body. Without this, a regression that breaks the success path (e.g., wrong status code on the `ctx.json()` return, missing fields in the descriptor) would not be caught.

**Fix:** Add a success-path test using the minimal 1×1 PNG already defined in the 409 test:
```typescript
Deno.test({
  name: "PUT /media: valid image returns 200 with BlobDescriptor",
  async fn() {
    const realHash = await sha256Hex(pngHeader);
    const auth = makeMediaAuth({ hash: realHash });
    const res = await app.fetch(
      new Request("http://localhost/media", {
        method: "PUT",
        headers: {
          "Content-Length": String(pngHeader.byteLength),
          "Content-Type": "image/png",
          "X-SHA-256": realHash,
          Authorization: encodeAuth(auth),
        },
        body: pngHeader.slice(),
      }),
    );
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(typeof json.sha256, "string");
    assertEquals(json.sha256.length, 64);
  },
  ...testOpts,
});
```

---

### IN-03: Shared mutable `app` / `cleanup` state across tests is setup-order-dependent

**File:** `tests/e2e/media.test.ts:70-115`, `tests/e2e/x-reason.test.ts:32-69`
**Issue:** Both test files use module-level `let app`, `let cleanup`, `let tmpDir` variables populated by a setup test that must run before all other tests. If Deno's test runner reorders tests (e.g., via `--filter` or future parallelism), any test that runs before the setup test will throw because `app` is `undefined`. The teardown test also has no guard to handle the case where `cleanup` was never set (e.g., if setup threw).

This pattern is common in this codebase and accepted as a deliberate tradeoff (single pool singleton), but the teardown should defensively guard against `cleanup` being undefined:

**Fix:**
```typescript
Deno.test({
  name: "media e2e teardown: cleanup",
  async fn() {
    if (cleanup) await cleanup();
  },
  ...testOpts,
});
```

---

_Reviewed: 2026-04-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
