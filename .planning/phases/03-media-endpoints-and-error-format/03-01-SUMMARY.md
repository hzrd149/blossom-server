---
phase: 03-media-endpoints-and-error-format
plan: 01
subsystem: media-endpoint
tags: [status-codes, bud-05, media, e2e-tests, hono]
dependency_graph:
  requires: []
  provides: [spec-compliant-media-status-codes, media-e2e-tests]
  affects: [src/routes/media.ts, tests/e2e/media.test.ts]
tech_stack:
  added: []
  patterns: [worker-job-error-classification, head-preflight-validation]
key_files:
  created:
    - tests/e2e/media.test.ts
  modified:
    - src/routes/media.ts
decisions:
  - "409 for HASH_MISMATCH worker error in PUT /media (mirrors upload.ts pattern)"
  - "422 (not 500) for optimization failure — signals unprocessable content, not server fault"
  - "HEAD /media preflight validates X-Content-Length and X-Content-Type before returning 200"
  - "Test config uses restricted storage rules (image/*, video/* only) to ensure 415 is testable"
metrics:
  duration: 5m
  completed: "2026-04-10"
  tasks_completed: 2
  files_changed: 2
---

# Phase 03 Plan 01: Media Endpoints Status Codes Summary

**One-liner:** PUT /media returns 409 for hash mismatch and 422 for optimization failure; HEAD /media validates Content-Length/Content-Type with 413/415; all verified by 6 E2E tests.

## What Was Built

Updated `src/routes/media.ts` to return exact BUD-spec status codes and added comprehensive E2E tests in `tests/e2e/media.test.ts`.

### Changes to src/routes/media.ts

1. **Imported `WorkerJobError`** from `../workers/pool.ts` — enables typed error classification in worker result handling.

2. **PUT /media worker error catch (line ~385):** Added `WorkerJobError` guard to return 409 instead of 400 for `HASH_MISMATCH` errors. This mirrors the exact pattern already used in `src/routes/upload.ts`.

3. **PUT /media optimization catch (line ~466):** Changed status code from 500 to 422. Optimization failure (sharp/FFmpeg rejecting the input) is a client content problem, not a server fault.

4. **HEAD /media preflight (lines ~173-210):** Added two new validation steps after the pool check:
   - Step 4: `X-Content-Length` / `Content-Length` → 413 if exceeds `config.media.maxSize`
   - Step 5: `X-Content-Type` / `Content-Type` → 415 if MIME type matches no storage rule

### New file: tests/e2e/media.test.ts

8 tests total (setup + 6 functional + teardown):

| Test | Expected Status | Verified |
|------|----------------|---------|
| PUT /media: mismatched X-SHA-256 | 409 + X-Reason "Hash mismatch" | Yes |
| PUT /media: oversized Content-Length | 413 | Yes |
| PUT /media: disallowed MIME type | 415 | Yes |
| HEAD /media: acceptable request | 200 | Yes |
| HEAD /media: oversized X-Content-Length | 413 | Yes |
| HEAD /media: disallowed X-Content-Type | 415 | Yes |

## Commits

| Hash | Message |
|------|---------|
| ef77b71 | feat(03-01): update PUT/HEAD /media status codes for spec compliance |
| 3806c73 | test(03-01): add E2E tests for PUT/HEAD /media status codes |

## Verification

- `deno check src/routes/media.ts` passes with no type errors
- All 6 E2E media tests pass
- Full test suite: 117 passed, 0 failed

## Deviations from Plan

**1. [Rule 2 - Missing critical detail] Test config uses restricted storage rules**

- **Found during:** Task 2
- **Issue:** Default storage rules include a wildcard `*` rule, so `application/x-executable` would match and NOT return 415. The 415 tests would have passed vacuously.
- **Fix:** Test config uses `{ rules: [{ type: "image/*", ... }, { type: "video/*", ... }] }` — no wildcard catch-all — so `application/x-executable` correctly triggers 415.
- **Files modified:** `tests/e2e/media.test.ts` (config in setup test)
- **Commit:** 3806c73

All other tasks executed exactly as specified in the plan.

## Known Stubs

None — all status code paths are wired to real handler logic.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. The HEAD /media preflight expansion is covered by T-03-01 in the plan's threat model.

## Self-Check: PASSED

- [x] `src/routes/media.ts` exists and modified
- [x] `tests/e2e/media.test.ts` exists and has 8 Deno.test blocks
- [x] Commit ef77b71 exists
- [x] Commit 3806c73 exists
- [x] 117 tests passed, 0 failed
