---
phase: 02-authorization-compatibility
reviewed: 2026-10-01T18:09:43Z
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
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-10-01T18:09:43Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Iteration 3 confirms the Phase 2 regressions remain resolved and no source changes were made after the five review fixes. Standard Base64 decodes through UTF-8 bytes, decoded JSON is structurally validated before dereference, HEAD preflight length parsing is whole-string and safe-integer checked, deferred authorization cleanup failures propagate as 500 errors, and the cleanup regression snapshots the real staging directory before and after the request. The focused authorization suite passes all 91 tests when run with the required LibSQL system permission; scoped formatting, lint, and diff checks also pass.

No active finding is attributable to the Phase 2 authorization compatibility changes. The two findings below are retained pre-existing warnings: their phase-boundary rationale correctly prevents an unsafe opportunistic fix, but the defects remain observable in the explicitly reviewed files.

## Narrative Findings (AI reviewer)

## Warnings

### WR-04: E2E setup and teardown remain filter-unsafe

**Classification:** WARNING
**File:** `tests/e2e/upload.test.ts:96-135`
**Issue:** Shared initialization and cleanup are still registered as ordinary named `Deno.test()` cases. A `--filter` selecting a PUT/HEAD assertion excludes the setup and teardown tests, leaving app state uninitialized and worker/temp resources unmanaged. The same pattern remains at `tests/e2e/delete.test.ts:109-162` and `tests/e2e/list.test.ts:90-138`. The fix report correctly identifies this as pre-existing cross-suite harness debt, so deferring it from the narrow authorization patch is reasonable; however, filtered test execution is a documented repository workflow, and the defect remains observable.
**Fix:** Handle this in a dedicated test-harness change: migrate all three suites to `@std/testing/bdd` `describe()` blocks with `beforeAll`/`afterAll`, or use parent tests with steps and unconditional `finally` cleanup so filtering cannot detach fixtures from assertions.

### WR-05: Storage commit can still outlive a failed metadata insert

**Classification:** WARNING
**File:** `src/routes/upload.ts:422-445`
**Issue:** The upload is committed to local/S3 storage before `insertBlob()` writes metadata. A database failure leaves an unreachable object with no database record. The fix report correctly notes that this ordering predates Phase 2 and that naive deletion is unsafe under concurrent deduplication, so it should not be patched opportunistically in this authorization phase; it remains an architectural consistency defect in the reviewed route.
**Fix:** Address this in a dedicated storage-consistency phase by making commit report whether it created the object and compensating only newly created objects, or by adding a recoverable pending-upload state that can be atomically finalized or reconciled after failure.

## Iteration 3 Status

- Prior CR-01: resolved; standard-Base64 bytes are UTF-8 decoded and the signed non-ASCII test forces the `+`/`/` alphabet path.
- Prior CR-02: resolved; `validateEvent()` plus explicit `id`/`sig` guards run before field access, and malformed decoded values return 400.
- Prior WR-01: resolved; malformed, signed, fractional, exponent, and unsafe `X-Content-Length` values return 400.
- Prior WR-02: resolved for the deferred authorization path; cleanup failures are surfaced and tested as 500 responses.
- Prior WR-03: resolved; the test awaits and compares `storageDir/.tmp` contents directly.
- Prior WR-04 and WR-05: unchanged, pre-existing, and appropriately deferred from Phase 2; retained as architectural/test-harness warnings because the configured review scope includes the affected files.

---

_Reviewed: 2026-10-01T18:09:43Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
