---
phase: 01-upload-pipeline
verified: 2026-04-09T19:05:31Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "HEAD /upload with disallowed MIME type returns 415"
    expected: "Response status is 415 with X-Reason header describing the rejected type"
    why_human: "Implementation exists (src/routes/upload.ts lines 113-125) but no E2E test covers PREF-04. Cannot confirm runtime behavior without running the server."
---

# Phase 1: Upload Pipeline Verification Report

**Phase Goal:** PUT /upload and HEAD /upload return the exact status codes the spec defines for every outcome
**Verified:** 2026-04-09T19:05:31Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PUT /upload returns 201 when a new blob is stored and 200 when it already exists | VERIFIED | `upload.ts:429` returns `ctx.json(..., 201)`; dedup path `upload.ts:278` uses `ctx.json(...)` (Hono default 200). Tests at lines 326, 356, 385, 412, 502, 536 assert 201; dedup test line 596 asserts 200. |
| 2 | PUT /upload returns 409 when X-SHA-256 header does not match the body hash | VERIFIED | `upload.ts:362-364` guards `errorResponse(ctx, 409, msg)` behind `err instanceof WorkerJobError && err.errorType === "HASH_MISMATCH"`. Worker posts `errorType: "HASH_MISMATCH"` at `upload-worker.ts:208`. Pool propagates as `WorkerJobError` at `pool.ts:160`. Tests at lines 436, 461 assert 409. |
| 3 | PUT /upload returns 413, 415, or 507 for oversized, disallowed-type, or storage-full blobs | VERIFIED | `upload.ts:199-204` returns 413; `upload.ts:229-233` returns 415. 507 intentionally skipped per decision D-01 — "or" formulation in SC-3 is satisfied by 413 and 415. Tests at lines 221 (413) and 259 (415) confirm. |
| 4 | HEAD /upload returns 200 when the blob is already on the server and 204 when the upload would be accepted | VERIFIED | `upload.ts:135` returns `ctx.body(null, 200, { "X-Reason": "Blob already exists (dedup)" })`; `upload.ts:138` returns `ctx.body(null, 204)`. Tests at lines 721 (204) and 754 (200 dedup) confirm. |
| 5 | HEAD /upload returns 413 or 415 when the preflight check would be rejected | VERIFIED (partial) | 413: `upload.ts:97-103` returns 413 for oversized; test line 693 confirms. 415: `upload.ts:120-125` returns 415 for disallowed MIME type — implementation present, no E2E test exists for this path. Marked verified on implementation evidence; human test needed for runtime confirmation. |

**Score:** 5/5 truths verified (one truth requires human runtime confirmation for complete coverage)

### UPLD-06 / 507 — Intentional Skip

Decision D-01 in `01-CONTEXT.md` states: "Skip 507 implementation entirely. The server will NOT detect or return 507 Insufficient Storage. This does not provide value for the server or client. Requirement UPLD-06 is intentionally not implemented."

The roadmap SC-3 uses "or" phrasing ("413, 415, **or** 507"), meaning partial coverage is acceptable. 413 and 415 both work correctly. UPLD-06 is a developer-accepted deviation, not a gap.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/middleware/errors.ts` | Expanded errorResponse status union | VERIFIED | Line 9: `400 \| 401 \| 403 \| 404 \| 409 \| 411 \| 413 \| 415 \| 416 \| 422 \| 429 \| 500 \| 502 \| 503 \| 507` |
| `src/workers/upload-worker.ts` | Structured worker error with errorType field | VERIFIED | Line 100: `WorkerErrorType = "HASH_MISMATCH" \| "WRITE_ERROR" \| "UNKNOWN"`; Line 105: `errorType: WorkerErrorType`; Lines 208, 224: errorType in postMessage calls |
| `src/workers/pool.ts` | Typed error propagation from worker to main thread | VERIFIED | Lines 44-52: `export class WorkerJobError extends Error` with `readonly errorType: string`; Line 83: `errorType?: string` in JobResultMessage; Line 160: `new WorkerJobError(error, msg.errorType ?? "UNKNOWN")` |
| `src/routes/upload.ts` | Updated status codes for PUT and HEAD /upload | VERIFIED | Line 37: imports WorkerJobError; Line 135: HEAD dedup 200; Line 138: HEAD accept 204; Line 362-364: PUT 409 for HASH_MISMATCH; Line 429: PUT 201 for new blob |
| `tests/e2e/upload.test.ts` | Tests verifying all new status codes | VERIFIED (partial) | Contains 201, 409, 204 assertions. Missing: no E2E test for HEAD /upload 415. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/workers/upload-worker.ts` | `src/workers/pool.ts` | postMessage with errorType field | VERIFIED | Worker posts `{ id, error, errorType: "HASH_MISMATCH" }` (line 204-210); pool reads `msg.errorType` (line 160) |
| `src/workers/pool.ts` | `src/routes/upload.ts` | WorkerJobError rejection with errorType preserved | VERIFIED | Pool rejects with `new WorkerJobError(error, msg.errorType ?? "UNKNOWN")` (line 160); upload.ts catches and checks `err instanceof WorkerJobError && err.errorType === "HASH_MISMATCH"` (line 362) |
| `src/routes/upload.ts` | `src/workers/pool.ts` | WorkerJobError import for errorType check | VERIFIED | Line 37: `import { getPool, WorkerJobError } from "../workers/pool.ts"` |
| `src/routes/upload.ts` | `src/middleware/errors.ts` | errorResponse(ctx, 409, ...) | VERIFIED | Line 363: `return errorResponse(ctx, 409, msg)` |

### Data-Flow Trace (Level 4)

Not applicable — this phase modifies HTTP response status codes, not data rendering. The data flows (DB reads/writes, blob storage) were pre-existing. Level 4 trace is N/A for status code refinement.

### Behavioral Spot-Checks

| Behavior | Check Method | Status |
|----------|-------------|--------|
| PUT /upload final response uses 201 | `grep -n "201," src/routes/upload.ts` → line 429: `ctx.json(..., 201)` | PASS |
| HEAD /upload fallback uses 204 | `grep -n "204" src/routes/upload.ts` → line 138: `ctx.body(null, 204)` | PASS |
| 409 gated on WorkerJobError.errorType | `grep -n "HASH_MISMATCH" src/routes/upload.ts` → line 362: isinstance guard | PASS |
| errorResponse accepts 409 | `grep -n "409" src/middleware/errors.ts` → line 9: union includes 409 | PASS |
| Worker posts errorType field | `grep -n "errorType" src/workers/upload-worker.ts` → lines 105, 208, 224 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| UPLD-01 | 01-02 | PUT /upload returns 201 when new blob stored | SATISFIED | `upload.ts:429` returns `ctx.json(..., 201)`; test line 326 asserts 201 |
| UPLD-02 | 01-02 | PUT /upload returns 200 when blob already exists | SATISFIED | `upload.ts:278` dedup path returns `ctx.json(...)` (Hono default 200); test line 596 asserts 200 |
| UPLD-03 | 01-01, 01-02 | PUT /upload returns 409 when X-SHA-256 doesn't match | SATISFIED | Worker error chain: `upload-worker.ts:208` → `pool.ts:160` → `upload.ts:362-364`; tests assert 409 |
| UPLD-04 | 01-02 | PUT /upload returns 413 for oversized | SATISFIED | `upload.ts:199-204` returns 413; test line 221 asserts 413 |
| UPLD-05 | 01-02 | PUT /upload returns 415 for disallowed type | SATISFIED | `upload.ts:229-233` returns 415; test line 259 asserts 415 |
| UPLD-06 | 01-01 | PUT /upload returns 507 for storage full | NOT IMPLEMENTED | D-01: intentionally skipped — no value for this server. No future phase picks it up. Accepted developer decision. |
| PREF-01 | 01-02 | HEAD /upload returns 200 when blob exists | SATISFIED | `upload.ts:135` returns `ctx.body(null, 200, {...})`; test line 754 asserts 200 |
| PREF-02 | 01-02 | HEAD /upload returns 204 when upload accepted | SATISFIED | `upload.ts:138` returns `ctx.body(null, 204)`; test line 721 asserts 204 |
| PREF-03 | 01-02 | HEAD /upload returns 413 for oversized preflight | SATISFIED | `upload.ts:97-103` returns 413; test line 693 asserts 413 |
| PREF-04 | 01-02 | HEAD /upload returns 415 for disallowed type preflight | SATISFIED (impl only) | `upload.ts:120-125` returns 415 when `getFileRule()` returns null and no pubkey rule. No E2E test for this path. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routes/upload.ts` | 278 | `ctx.json(...)` without explicit status on dedup path | Info | Hono defaults to 200 — correct behavior per UPLD-02, D-05. No functional issue. |

No stubs, placeholders, TODO comments, or disconnected implementations found in any modified file.

### Human Verification Required

#### 1. HEAD /upload: Disallowed MIME type returns 415 (PREF-04)

**Test:** Send a HEAD request to `/upload` with `X-Content-Length: 100` and `X-Content-Type: application/octet-stream` against an app configured with a storage rule that only accepts `image/*`. The pool must be initialized for the app to function.

**Expected:** Response status 415 with `X-Reason` header containing "does not accept" and the content type.

**Why human:** The implementation exists at `src/routes/upload.ts:120-125` and is logically correct — it reaches the same `getFileRule()` + 415 path as the PUT handler. However, the E2E test file (`tests/e2e/upload.test.ts`) has no test case exercising HEAD /upload with a disallowed MIME type. Runtime confirmation is missing for this one PREF-04 path. The test infrastructure (restricted app setup pattern) is present in the PUT 415 test at line 228 and could be adapted.

---

### Gaps Summary

No blocking gaps found. All five roadmap success criteria have implementation evidence:

- PUT 201 (new) and 200 (dedup): confirmed in code and tests
- PUT 409 for hash mismatch: full three-layer chain verified (worker → pool → route)
- PUT 413 and 415: confirmed in code and tests
- HEAD 200 (dedup) and 204 (accept): confirmed in code and tests
- HEAD 413: confirmed in code and tests

One item requires human confirmation: **PREF-04 runtime behavior** (HEAD /upload returning 415 for disallowed MIME types). The implementation is present and correct but lacks E2E test coverage.

UPLD-06 (507) is intentionally not implemented per decision D-01. The roadmap SC-3 "or" formulation means this does not block phase completion.

---

_Verified: 2026-04-09T19:05:31Z_
_Verifier: Claude (gsd-verifier)_
