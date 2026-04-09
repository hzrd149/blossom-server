---
phase: 02-read-side-operations
plan: 01
subsystem: delete-handler
tags: [status-codes, delete, bud-02, e2e-tests]
dependency_graph:
  requires: []
  provides: [DELT-01, DELT-02]
  affects: [src/routes/delete.ts, tests/e2e/delete.test.ts]
tech_stack:
  added: []
  patterns: [tdd, e2e-test]
key_files:
  created:
    - tests/e2e/delete.test.ts
  modified:
    - src/routes/delete.ts
decisions:
  - "DELETE returns 204 No Content (not 200) for all successful deletions — both ownership-only removal and full purge paths"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-09"
  tasks_completed: 2
  files_changed: 2
---

# Phase 02 Plan 01: DELETE Status Code Update Summary

## One-Liner

DELETE /<sha256> now returns 204 No Content for all successful deletions, with full E2E test coverage for all status codes (204, 400, 401, 403, 404).

## What Was Done

### Task 1: Change DELETE success status from 200 to 204 (commit: 1b5d956)

Updated `src/routes/delete.ts` — two `ctx.body(null, 200)` calls changed to `ctx.body(null, 204)`:
- Line 87: ownership-only removal path (other owners remain)
- Line 99: full purge path (no owners left)

Both success paths now return 204 No Content per DELT-01 requirement.

### Task 2: Create E2E tests for DELETE endpoint status codes (commit: f0e7d79)

Created `tests/e2e/delete.test.ts` with 7 tests (setup + 5 status code tests + teardown):
- 204: successful deletion with empty body
- 404: non-existent hash
- 400: invalid hash format
- 401: missing auth when required
- 403: non-owner deletion attempt

All 7 tests pass.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new security surface introduced. The two status code changes (200 → 204) affect no trust boundaries and do not alter authentication or authorization logic.

## Known Stubs

None.

## Self-Check: PASSED

- `src/routes/delete.ts` — exists, contains exactly 2 occurrences of `ctx.body(null, 204)`, 0 of `ctx.body(null, 200)`
- `tests/e2e/delete.test.ts` — exists, 293 lines, all 7 tests pass
- Commit `1b5d956` — feat(02-01): change DELETE success status from 200 to 204
- Commit `f0e7d79` — test(02-01): add E2E tests for DELETE endpoint status codes
