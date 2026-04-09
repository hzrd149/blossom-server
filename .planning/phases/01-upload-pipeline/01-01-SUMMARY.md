---
phase: 01-upload-pipeline
plan: "01"
subsystem: worker-error-protocol
tags: [errors, workers, status-codes, infrastructure]
dependency_graph:
  requires: []
  provides: [expanded-error-status-union, worker-job-error-class, typed-error-propagation]
  affects: [src/routes/upload.ts, src/routes/media.ts, src/routes/mirror.ts]
tech_stack:
  added: []
  patterns: [discriminated-union-error-types, error-subclass-with-metadata]
key_files:
  created: []
  modified:
    - src/middleware/errors.ts
    - src/workers/upload-worker.ts
    - src/workers/pool.ts
decisions:
  - "Used Error subclass (WorkerJobError) rather than tagged union to preserve instanceof checks across async boundaries"
  - "WorkerErrorType is a closed string literal union in the worker; pool accepts string to avoid import coupling"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-09T18:44:15Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 01 Plan 01: Error Infrastructure and Worker Error Protocol Summary

**One-liner:** Expanded errorResponse status union (409/416/422/507) and added WorkerJobError discriminated error class for hash-mismatch-to-409 mapping in future plan.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Expand errorResponse status union and add worker error types | bd53c46 | src/middleware/errors.ts, src/workers/upload-worker.ts |
| 2 | Propagate typed worker errors through pool to main thread | 780b431 | src/workers/pool.ts |

## What Was Built

### Task 1 — errorResponse + WorkerErrorType

**src/middleware/errors.ts:** The `status` parameter union was expanded from `400 | 401 | 403 | 404 | 411 | 413 | 415 | 429 | 500 | 502 | 503` to include `409` (Conflict), `416` (Range Not Satisfiable), `422` (Unprocessable Content), and `507` (Insufficient Storage). This enables all route handlers in subsequent plans to use `errorResponse()` for the new spec-mandated status codes.

**src/workers/upload-worker.ts:** Added a `WorkerErrorType = "HASH_MISMATCH" | "WRITE_ERROR" | "UNKNOWN"` string literal union and added an `errorType: WorkerErrorType` field to the `JobError` interface. The hash mismatch postMessage now includes `errorType: "HASH_MISMATCH"` and the catch block includes `errorType: "UNKNOWN"`.

### Task 2 — WorkerJobError in pool.ts

**src/workers/pool.ts:** Added an exported `WorkerJobError extends Error` class with a readonly `errorType: string` field. Added `errorType?: string` to `JobResultMessage`. The rejection path now uses `new WorkerJobError(error, msg.errorType ?? "UNKNOWN")` instead of `new Error(error)`, preserving the error type through the Promise rejection chain.

## Decisions Made

- **WorkerJobError as Error subclass:** Chose `extends Error` over a tagged union wrapper so that `err instanceof WorkerJobError` checks work naturally in catch blocks in route handlers (Plan 02).
- **String type in pool, literal union in worker:** The pool accepts `string` for `errorType` to avoid coupling the pool module to the worker's type definitions. The worker enforces the closed set via `WorkerErrorType`.

## Verification

`deno check src/middleware/errors.ts src/workers/upload-worker.ts src/workers/pool.ts` — passed with no type errors.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None. Changes are internal infrastructure only — no new network endpoints, auth paths, or trust boundaries introduced.

## Self-Check: PASSED

- [x] src/middleware/errors.ts exists and contains `409`
- [x] src/workers/upload-worker.ts exists and contains `HASH_MISMATCH`
- [x] src/workers/pool.ts exists and contains `WorkerJobError`
- [x] Commit bd53c46 exists
- [x] Commit 780b431 exists
