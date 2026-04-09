---
phase: 01-upload-pipeline
plan: 02
status: complete
started: 2026-04-09
completed: 2026-04-09
tasks_completed: 2
tasks_total: 2
deviations: none
---

# Plan 01-02 Summary: Upload Handler Status Codes

## What Was Built

Updated PUT /upload and HEAD /upload handlers to return BUD-spec-compliant HTTP status codes, and updated all E2E tests to verify the new codes.

## Changes

### Task 1: Update PUT /upload and HEAD /upload status codes

**src/routes/upload.ts:**
- Import `WorkerJobError` from `../workers/pool.ts`
- PUT /upload: returns `201` for new blob uploads (was implicit 200)
- PUT /upload: returns `409` for hash mismatch errors (was generic 400), guarded by `err instanceof WorkerJobError && err.errorType === "HASH_MISMATCH"`
- PUT /upload: returns `200` for dedup path (unchanged, already correct)
- HEAD /upload: returns `204` when upload would be accepted (was 200)
- HEAD /upload: returns `200` with X-Reason when blob already exists (unchanged)

### Task 2: Update E2E tests for new status codes

**tests/e2e/upload.test.ts:**
- All new-upload tests assert `201` instead of `200`
- Hash mismatch test asserts `409` instead of `400`
- HEAD preflight test asserts `204` instead of `200`
- Dedup test split: first upload asserts `201`, second asserts `200`
- Added dedicated test for 409 with X-Reason header containing mismatch info
- List test and HEAD dedup test upload assertions updated to `201`

## Self-Check: PASSED

- [x] All tasks executed (2/2)
- [x] Each task committed individually
- [x] Type check passes (`deno check src/routes/upload.ts`)
- [x] Status codes match BUD spec exactly

## Key Files

### key-files.created
- tests/e2e/upload.test.ts (updated)

### key-files.modified
- src/routes/upload.ts

## Deviations

None. All changes match the plan exactly.
