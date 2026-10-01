---
phase: 02-authorization-compatibility
reviewed: 2026-10-01T17:49:13Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/middleware/auth.ts
  - src/routes/upload.ts
  - tests/unit/auth.test.ts
  - tests/e2e/upload.test.ts
  - tests/e2e/delete.test.ts
  - tests/e2e/list.test.ts
  - CHANGELOG.md
findings:
  critical: 2
  warning: 5
  info: 0
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-10-01T17:49:13Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

The intended authorization policy is present: expiration is checked as a complete decimal safe integer, expired tokens return 401, no future-lifetime cap was added, required `x` scope uses exact matching and returns 403 for both missing and mismatched scope, and authenticated headerless HEAD preflight remains accepted. The focused suite passes all 88 tests.

The implementation is not ready to ship because two malformed/compatible authorization inputs still take incorrect paths: valid standard-Base64 UTF-8 events can fail signature verification, and decodable non-event JSON can trigger 500 responses. The review also found weak numeric preflight validation, cleanup failures that are suppressed, a cleanup regression test that never inspects staged files, filter-unsafe E2E fixtures, and a storage/metadata consistency gap.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Standard-Base64 fallback corrupts UTF-8 event JSON

**Classification:** BLOCKER
**File:** `src/middleware/auth.ts:69-76`
**Issue:** When Base64url decoding rejects a standard-Base64 token containing `+` or `/`, the fallback uses `atob(raw)` directly as a JavaScript string. `atob()` returns the encoded bytes as Latin-1 code units; it does not UTF-8-decode them. A valid signed event whose `content` contains non-ASCII text is therefore parsed with corrupted content and rejected as an invalid signature. This violates the locked standard-Base64 compatibility behavior. The new test at `tests/unit/auth.test.ts:63-68` does not expose the defect because its generated encoding contains neither `+` nor `/`, so the Base64url decoder handles it and the fallback is never exercised.
**Fix:** Decode both alphabets to bytes and pass both through `TextDecoder`, then add a signed UTF-8 fixture whose standard-Base64 text is asserted to contain `+` or `/`:

```ts
import { decodeBase64 } from "@std/encoding/base64";

try {
  decoded = new TextDecoder().decode(decodeBase64Url(raw));
} catch {
  decoded = new TextDecoder().decode(decodeBase64(raw));
}
```

### CR-02: Decodable malformed auth JSON escapes validation as a 500

**Classification:** BLOCKER
**File:** `src/middleware/auth.ts:77-95`
**Issue:** `JSON.parse()` is cast directly to `NostrEvent`, then fields and `auth.tags.find()` are dereferenced before structural validation. Inputs such as Base64url-encoded `null` or `{ "kind": 24242, "created_at": 0, "tags": null }` throw `TypeError`; `authMiddleware()` classifies that as an internal error and returns 500. An unauthenticated remote caller can trigger this on every route, producing incorrect server errors and warning/stack-log noise instead of the documented 400 auth-validation response.
**Fix:** Keep the parsed value as `unknown` and structurally validate it before any dereference. `nostr-tools/pure` already exports the non-cryptographic `validateEvent()` guard; use it first, return an `HTTPException(400)` when it fails, then retain `verifyEvent()` at the end for signature verification. Add cases for `null`, primitives, missing/non-array `tags`, and malformed tag elements.

## Warnings

### WR-01: HEAD preflight accepts malformed length prefixes

**Classification:** WARNING
**File:** `src/routes/upload.ts:100-108`
**Issue:** `parseInt()` accepts a numeric prefix, so values such as `100junk`, `1.5`, and `1e12` are treated as 100, 1, and 1. The server can return 200 for a preflight whose `X-Content-Length` is not a valid byte count, undermining the endpoint's admission result and boundary validation.
**Fix:** Require a complete decimal string, convert with `Number()`, and require a non-negative safe integer before comparing against `maxSize`.

### WR-02: Deferred authorization cleanup failures are silently reported as successful denial

**Classification:** WARNING
**File:** `src/routes/upload.ts:395-405`
**Issue:** The post-hash scope-denial path suppresses every `abortWrite()` failure and still returns 403. The storage implementations also suppress file-removal failures, so unauthorized staged bytes can remain on disk without any log, retry, or error signal. Repeated failures can accumulate attacker-controlled data even though each request appears cleanly rejected.
**Fix:** Make `abortWrite()` propagate removal failures, log the temp path and error, and do not silently convert a failed cleanup into the normal 403 path. Return 500 or enqueue a bounded cleanup retry while preserving the authorization denial in logs/metrics.

### WR-03: Staging cleanup regression test never looks inside the staging directory

**Classification:** WARNING
**File:** `tests/e2e/upload.test.ts:561-581`
**Issue:** The test snapshots `storageDir`, but upload sessions are written beneath `storageDir/.tmp`. Both snapshots therefore contain the same `.tmp` directory whether the staged file was removed or leaked. In addition, `entriesBefore` is left as an unawaited promise while the upload starts, making the baseline timing nondeterministic. The test's metadata/404 assertion is useful, but its claimed staged-byte cleanup coverage is a false positive.
**Fix:** Await the baseline before the request and snapshot the actual staging directory (`join(storageDir, ".tmp")` or `storage.tmpDir`) before and after the denied upload. Assert that the exact staged-file set is unchanged/empty.

### WR-04: E2E setup and teardown are ordinary filterable tests

**Classification:** WARNING
**File:** `tests/e2e/upload.test.ts:96-135`
**Issue:** Shared initialization and cleanup are registered as named `Deno.test()` cases. Running the repository-supported `deno test --filter "PUT /upload ..."` or the focused filters documented in phase research excludes the setup test, leaving `appNoAuth`, `appWithAuth`, and cleanup state uninitialized; similarly, filtering can omit teardown and leak workers/temp directories. The same pattern appears at `tests/e2e/delete.test.ts:109-162` and `tests/e2e/list.test.ts:90-138`.
**Fix:** Put the suites under `@std/testing/bdd` `describe()` with `beforeAll`/`afterAll`, or use a single parent `Deno.test` with steps and `finally` cleanup so filtering cannot detach fixtures from assertions.

### WR-05: A database failure after storage commit leaves an orphaned blob

**Classification:** WARNING
**File:** `src/routes/upload.ts:413-435`
**Issue:** The route commits the verified temp file to local/S3 storage and only afterward inserts its metadata. If `insertBlob()` fails, the request returns 500 but the committed object remains with no database record, making it unreachable through normal APIs and invisible to metadata-driven cleanup. This is a storage/metadata consistency defect.
**Fix:** Make the commit operation report whether it created a new object and compensate on DB failure without deleting a pre-existing/concurrently deduplicated object, or introduce a recoverable pending-upload transaction/state that startup maintenance can reconcile.

---

_Reviewed: 2026-10-01T17:49:13Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
