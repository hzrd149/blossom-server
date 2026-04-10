---
phase: 02-read-side-operations
reviewed: 2026-04-09T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/routes/delete.ts
  - tests/e2e/delete.test.ts
  - tests/e2e/blobs.test.ts
  - tests/e2e/list.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-04-09
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the delete route handler and three E2E test files (delete, blobs/range-requests, list). The source code is well-structured with clear separation of concerns. The delete handler correctly implements multi-owner semantics, BUD-11 auth enforcement, and best-effort storage cleanup. The test files provide good coverage of status codes (400, 401, 403, 404, 204 for delete; 200, 206, 416, 404 for blobs; 200, 400 for list).

Two warnings were found: an information disclosure pattern in the delete route (blob existence check before auth) and a potential test ordering fragility in the delete test suite.

## Warnings

### WR-01: Blob Existence Check Before Authentication Enables Enumeration

**File:** `src/routes/delete.ts:56-59`
**Issue:** The handler checks whether the blob exists (returning 404) before enforcing authentication (line 63). When `config.delete.requireAuth` is true, an unauthenticated caller can distinguish between "blob exists" (401 from requireAuth) and "blob does not exist" (404) by sending DELETE requests without credentials. This allows unauthenticated enumeration of blob SHA-256 hashes on the server.
**Fix:** Move the blob existence check after the auth enforcement block, or return a uniform 401 for unauthenticated requests regardless of blob existence:
```typescript
// Option A: check auth first, then blob existence
if (config.delete.requireAuth) {
  const auth = requireAuth(ctx, "delete");
  pubkey = auth.pubkey;
  requireXTag(auth, hash);
}

const blob = await getBlob(db, hash);
if (!blob) {
  return errorResponse(ctx, 404, "Blob not found");
}

if (pubkey !== null && !(await isOwner(db, hash, pubkey))) {
  return errorResponse(ctx, 403, "You are not an owner of this blob");
}
```

### WR-02: Delete Test Suite Depends on Sequential Test Execution Order

**File:** `tests/e2e/delete.test.ts:266-280`
**Issue:** The "successful deletion returns 204" test (line 266) relies on `blobHash` being set during the setup test (line 96) and not yet deleted by any prior test. If Deno's test runner ever parallelizes tests within a file, or if test ordering changes, this test would fail non-deterministically. The test also does not verify that the blob is actually gone after deletion (e.g., a follow-up GET returning 404), which weakens the assertion.
**Fix:** Upload a dedicated blob within the test itself rather than relying on shared mutable state from setup, and add a verification step:
```typescript
// Upload a fresh blob specifically for this test
const freshData = new TextEncoder().encode("delete success test");
const freshHash = await sha256Hex(freshData);
// ... upload, then delete, then verify with GET returning 404
```

## Info

### IN-01: Duplicate Helper Functions Across Test Files

**File:** `tests/e2e/delete.test.ts:39-45`, `tests/e2e/blobs.test.ts:33-39`, `tests/e2e/list.test.ts:34-40`
**Issue:** The `sha256Hex`, `encodeAuth`, and `makeUploadAuth` helper functions are copy-pasted across all three test files. This duplication increases maintenance burden -- any fix or change must be applied in multiple places.
**Fix:** Extract shared test helpers into a `tests/e2e/helpers.ts` module and import from there.

### IN-02: Unused Import in Delete Test File

**File:** `tests/e2e/delete.test.ts:22`
**Issue:** `getPublicKey` is imported and used to derive `pk` (line 37), but `pk` is never referenced in any test assertion or setup logic in this file. The variable exists but serves no purpose.
**Fix:** Remove the unused `pk` variable and the `getPublicKey` import if not needed:
```typescript
// Remove these lines:
// import { getPublicKey } from "nostr-tools/pure";
// const pk = getPublicKey(sk);
```

---

_Reviewed: 2026-04-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
