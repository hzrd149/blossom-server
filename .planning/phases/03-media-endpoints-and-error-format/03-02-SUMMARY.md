---
phase: 03-media-endpoints-and-error-format
plan: 02
subsystem: error-format
tags: [x-reason, errf-01, errf-02, e2e-tests, audit]
dependency_graph:
  requires: [03-01]
  provides: [x-reason-e2e-tests, errf-01-verified, errf-02-audited]
  affects: [tests/e2e/x-reason.test.ts]
tech_stack:
  added: []
  patterns: [shared-server-e2e-setup, error-path-coverage]
key_files:
  created:
    - tests/e2e/x-reason.test.ts
  modified: []
decisions:
  - "Use 3 GB Content-Length (exceeds 2 GB default) to reliably trigger 413 on PUT /upload in shared-config test"
  - "ERRF-02 audit confirms no server-side X-Reason reads for control flow"
metrics:
  duration: 4m
  completed: "2026-04-10"
  tasks_completed: 1
  files_changed: 1
---

# Phase 03 Plan 02: X-Reason Error Format Summary

**One-liner:** E2E tests verify X-Reason header is present and non-empty on all major error paths; ERRF-02 audit confirms X-Reason is diagnostic-only with no server-side control flow reads.

## What Was Built

Created `tests/e2e/x-reason.test.ts` with 7 tests (setup + 5 functional + teardown) verifying X-Reason header presence across all major endpoint categories.

### New file: tests/e2e/x-reason.test.ts

7 tests total (setup + 5 functional + teardown):

| Test | Status | Endpoint | X-Reason Verified |
|------|--------|----------|-------------------|
| GET non-existent blob | 404 | GET /<sha256> | Yes |
| PUT /upload missing Content-Length | 411 | PUT /upload | Yes |
| HEAD /media oversized | 413 | HEAD /media | Yes |
| PUT /upload oversized | 413 | PUT /upload | Yes |
| GET /list invalid limit | 400 | GET /list/:pubkey | Yes |

Every test asserts both `assertNotEquals(reason, null)` and `assertNotEquals(reason, "")` to confirm X-Reason is present and non-empty.

## ERRF-02 Audit: X-Reason Control Flow

**Grep result:** `grep -rn "X-Reason" src/`

| File | Line | Operation | Purpose |
|------|------|-----------|---------|
| `src/middleware/errors.ts` | 13 | WRITE | Sets X-Reason on every `errorResponse()` call |
| `src/routes/blossom-router.ts` | 43 | WRITE | Sets X-Reason on HTTPException in onError |
| `src/routes/blossom-router.ts` | 49 | WRITE | Sets X-Reason on unhandled errors in onError |
| `src/routes/upload.ts` | 135 | WRITE | Sets X-Reason on 200 dedup response |
| `src/middleware/cors.ts` | 13 | EXPOSE | `exposeHeaders: ["X-Reason", ...]` — allows clients to read |
| `src/middleware/errors.ts` | 25 | COMMENT | Documents X-Reason formatting location |
| `src/middleware/logger.ts` | 5 | COMMENT | Mentions X-Reason in log description |
| `src/server.ts` | 29, 71 | COMMENT | Architecture notes about X-Reason |
| `src/landing/client/api.ts` | 25 | CLIENT READ | `getResponseHeader("X-Reason")` — error message string only |
| `src/landing/client/api.ts` | 58 | CLIENT READ | `headers.get("X-Reason")` — error message string only |

**Conclusion:** ERRF-02 is **satisfied**.

- **Server-side:** All X-Reason usages are WRITE operations. No server code reads X-Reason from incoming requests or uses X-Reason value for any branching, routing, or conditional logic.
- **Client-side:** `src/landing/client/api.ts` reads X-Reason at lines 25 and 58, but exclusively to construct user-facing error message strings (`reject(new Error(...))` and `throw new Error(...)`). No conditional branching on X-Reason value in either location.
- **CORS:** `src/middleware/cors.ts` exposes X-Reason via `exposeHeaders` so browser clients can read it — this is the intended diagnostic use.

## Commits

| Hash | Message |
|------|---------|
| 934f172 | test(03-02): add E2E tests verifying X-Reason on error responses |

## Verification

- All 7 X-Reason E2E tests pass
- Full test suite: 124 passed, 0 failed
- `grep -rn "X-Reason" src/` confirms only write operations in server code

## Deviations from Plan

**1. [Rule 1 - Bug] Content-Length value adjusted to exceed 2 GB default maxSize**

- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan specified `Content-Length: 999999999` (~1 GB) for the PUT /upload 413 test, but the default upload maxSize is 2 GB (2,147,483,648 bytes). 1 GB < 2 GB, so the upload succeeded with 201 instead of rejecting with 413.
- **Fix:** Changed Content-Length to `3 * 1024 * 1024 * 1024` (3 GB) which exceeds the 2 GB default and correctly triggers 413.
- **Files modified:** `tests/e2e/x-reason.test.ts`
- **Commit:** 934f172

All other aspects executed exactly as specified in the plan.

## Known Stubs

None — all tests exercise real server behavior with no mocked responses.

## Threat Flags

None — this plan only adds tests. No new network endpoints, auth paths, file access patterns, or schema changes were introduced.

## Self-Check: PASSED

- [x] `tests/e2e/x-reason.test.ts` exists with 7 `Deno.test` blocks
- [x] Every test asserts `assertNotEquals(reason, null, ...)` where `reason = res.headers.get("X-Reason")`
- [x] Every test asserts `assertNotEquals(reason, "", ...)` for non-empty verification
- [x] Tests cover 3+ different endpoint categories (blobs, upload, media, list)
- [x] All 7 tests pass
- [x] Commit 934f172 exists
- [x] ERRF-02 audit documented
