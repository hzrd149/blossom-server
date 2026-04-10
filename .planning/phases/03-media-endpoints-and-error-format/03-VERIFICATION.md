---
phase: 03-media-endpoints-and-error-format
verified: 2026-04-10T00:00:00Z
status: human_needed
score: 9/11 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run the full E2E test suite: deno test --env-file=.env --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/e2e/media.test.ts tests/e2e/x-reason.test.ts"
    expected: "All 15 tests pass (8 media + 7 x-reason). 0 failures."
    why_human: "Tests exercise a real worker pool with MessagePorts, real SQLite DB, and real temp-dir lifecycle. Cannot run deno test in the verifier sandbox environment."
---

# Phase 3: Media Endpoints and Error Format — Verification Report

**Phase Goal:** PUT /media and HEAD /media return exact spec status codes, and all error responses use X-Reason as a diagnostic-only header
**Verified:** 2026-04-10
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PUT /media responds 200 on success, 409 for hash mismatch, 422 when media cannot be processed | PARTIAL | 409: `errorResponse(ctx, 409, msg)` at line 386 guarded by `WorkerJobError && errorType === "HASH_MISMATCH"`. 422: `errorResponse(ctx, 422, msg)` at line 466 on optimization failure. 200: code path exists (step 19, `ctx.json(...)`) but no E2E test covers PUT /media successful upload — only HEAD /media 200 is tested. |
| 2 | PUT /media responds 413, 415, or 507 for oversized, disallowed-type, or storage-full uploads | PARTIAL | 413: line 286 in PUT handler. 415: line 315 in PUT handler. 507: intentionally not implemented per D-01 decision (same as Phase 1 for upload). No E2E test for PUT /media 200 to confirm the success path baseline. |
| 3 | HEAD /media responds 200 when acceptable, 413 or 415 when rejected | ✓ VERIFIED | 200: `ctx.body(null, 200)` at line 211. 413: `errorResponse(ctx, 413,...)` at line 180. 415: `errorResponse(ctx, 415,...)` at line 205. E2E tests at media.test.ts lines 224-272 cover all three. |
| 4 | Every error response includes an X-Reason header with a human-readable diagnostic string | ✓ VERIFIED | `errorResponse()` in errors.ts always sets `"X-Reason": reason` (line 13). blossom-router.ts onError sets X-Reason on HTTPException (line 43) and unhandled errors (line 49). X-Reason verified by E2E tests in x-reason.test.ts across 404, 411, 413, 400 responses. |
| 5 | No code path uses X-Reason for conditional logic or control flow | ✓ VERIFIED | grep -rn "X-Reason" src/ shows: only WRITE operations in server code (errors.ts:13, blossom-router.ts:43/49, upload.ts:135 dedup response, cors.ts:13 expose). Client reads in landing/client/api.ts:25,58 are for error message string construction only — no conditional branching. |

**Score:** 3/5 truths fully verified (Truths 3, 4, 5). Truths 1 and 2 are partial due to MDIA-06 intentional skip and absence of PUT /media success test.

### Must-Haves from PLAN Frontmatter

**Plan 03-01 Truths:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PUT /media returns 200 on successful upload (new or dedup) | ? UNCERTAIN | Code path exists (ctx.json at step 19), but requires real image + sharp for optimization. No E2E test verifies this path. Needs human verification. |
| 2 | PUT /media returns 409 when X-SHA-256 does not match computed hash | ✓ VERIFIED | WorkerJobError guard at media.ts:385-387. E2E test at media.test.ts:121-160 asserts status 409 + X-Reason matching /[Hh]ash mismatch/. |
| 3 | PUT /media returns 422 when optimization fails | ✓ VERIFIED | errorResponse(ctx, 422, msg) at media.ts:466. Changed from 500 (old) to 422. |
| 4 | PUT /media returns 413 for oversized uploads | ✓ VERIFIED | errorResponse(ctx, 413,...) at media.ts:286. E2E test at media.test.ts:166-189. |
| 5 | PUT /media returns 415 for disallowed MIME types | ✓ VERIFIED | errorResponse(ctx, 415,...) at media.ts:315. E2E test at media.test.ts:195-218. |
| 6 | HEAD /media returns 200 when the request is acceptable | ✓ VERIFIED | ctx.body(null, 200) at media.ts:211. E2E test at media.test.ts:224-234. |
| 7 | HEAD /media returns 413 when Content-Length exceeds media.maxSize | ✓ VERIFIED | errorResponse(ctx, 413,...) at media.ts:180. E2E test at media.test.ts:240-253. |
| 8 | HEAD /media returns 415 when Content-Type is not in allowlist | ✓ VERIFIED | errorResponse(ctx, 415,...) at media.ts:205. E2E test at media.test.ts:259-272. |

**Plan 03-02 Truths:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every error response from errorResponse() includes an X-Reason header | ✓ VERIFIED | errors.ts:13 always sets "X-Reason": reason in every call. |
| 2 | Every error response from blossom-router onError includes an X-Reason header | ✓ VERIFIED | blossom-router.ts:43 (HTTPException) and :49 (unhandled) both set X-Reason. |
| 3 | No server-side code reads X-Reason for conditional logic or control flow | ✓ VERIFIED | grep confirms all server-side references are writes or comments. |
| 4 | Client-side X-Reason reads are diagnostic only (error message display) | ✓ VERIFIED | landing/client/api.ts:25,58 read X-Reason to build error message strings only — no branching. |

**Combined score: 9 of 11 plan must-haves verified. Must-have 1 (PUT /media 200 success) requires human verification.**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/routes/media.ts` | Updated PUT/HEAD /media error handling | ✓ VERIFIED | WorkerJobError imported (line 59), 409 guard (lines 385-387), 422 (line 466), 413 (lines 180, 286), 415 (lines 205, 315), HEAD 200 (line 211). |
| `tests/e2e/media.test.ts` | E2E tests for media status codes | ✓ VERIFIED | 284 lines, 8 Deno.test blocks (setup + 6 functional + teardown). All 6 expected status code assertions present. |
| `tests/e2e/x-reason.test.ts` | E2E tests for X-Reason across endpoints | ✓ VERIFIED | 176 lines, 7 Deno.test blocks (setup + 5 functional + teardown). Every test asserts assertNotEquals(reason, null) and assertNotEquals(reason, ""). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/routes/media.ts | src/workers/pool.ts | WorkerJobError import | ✓ WIRED | Line 59: `import { getPool, WorkerJobError } from "../workers/pool.ts"`. Used at line 385 for HASH_MISMATCH check. |
| src/routes/media.ts | src/middleware/errors.ts | errorResponse(ctx, 409,...) and errorResponse(ctx, 422,...) | ✓ WIRED | 409 at line 386, 422 at line 466. errorResponse imported at line 54. |
| src/middleware/errors.ts | all route handlers | X-Reason in every errorResponse() call | ✓ WIRED | errors.ts:13 `"X-Reason": reason` in ctx.body() call. |
| src/routes/blossom-router.ts | all blossom routes | onError handler sets X-Reason | ✓ WIRED | Lines 43 and 49 set X-Reason on all error paths within Blossom sub-app scope. |

### Data-Flow Trace (Level 4)

Not applicable for this phase — changes are status code and header changes in existing handlers, not new data rendering components.

### Behavioral Spot-Checks

| Behavior | Check | Status |
|----------|-------|--------|
| WorkerJobError import present | grep line 59 media.ts | ✓ PASS |
| 409 guarded by WorkerJobError HASH_MISMATCH | grep lines 385-387 | ✓ PASS |
| 422 on optimization failure (not 500) | grep line 466 | ✓ PASS |
| HEAD /media 413 preflight | grep lines 174-184 | ✓ PASS |
| HEAD /media 415 preflight | grep lines 187-209 | ✓ PASS |
| errorResponse always sets X-Reason | errors.ts:13 | ✓ PASS |
| blossom-router onError sets X-Reason | blossom-router.ts:43,49 | ✓ PASS |
| Commits exist | git cat-file ef77b71, 3806c73, 934f172 | ✓ PASS |
| Test file line counts ≥ minimums | media: 284, x-reason: 176 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MDIA-01 | 03-01 | PUT /media returns 200 on success | ? UNCERTAIN | Code path exists but not E2E tested for PUT. Needs human. |
| MDIA-02 | 03-01 | PUT /media returns 409 for hash mismatch | ✓ SATISFIED | media.ts:385-387 + E2E test status 409. |
| MDIA-03 | 03-01 | PUT /media returns 413 for oversized | ✓ SATISFIED | media.ts:286 + E2E test status 413. |
| MDIA-04 | 03-01 | PUT /media returns 415 for disallowed type | ✓ SATISFIED | media.ts:315 + E2E test status 415. |
| MDIA-05 | 03-01 | PUT /media returns 422 for optimization failure | ✓ SATISFIED | media.ts:466 (changed from 500). |
| MDIA-06 | 03-01 | PUT /media returns 507 for storage full | INTENTIONAL SKIP | D-01: Not implemented, same decision as Phase 1 for UPLD-06. No later phase addresses this. |
| MDPF-01 | 03-01 | HEAD /media returns 200 when acceptable | ✓ SATISFIED | media.ts:211 + E2E test status 200. |
| MDPF-02 | 03-01 | HEAD /media returns 413 for oversized | ✓ SATISFIED | media.ts:180 + E2E test status 413. |
| MDPF-03 | 03-01 | HEAD /media returns 415 for disallowed type | ✓ SATISFIED | media.ts:205 + E2E test status 415. |
| ERRF-01 | 03-02 | All error responses include X-Reason header | ✓ SATISFIED | errorResponse() always sets X-Reason + blossom-router onError sets X-Reason + E2E tests confirm presence. |
| ERRF-02 | 03-02 | X-Reason is diagnostic only, not used for control flow | ✓ SATISFIED | grep audit: no server-side reads for branching. Client reads are message-string construction only. |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| src/middleware/errors.ts | Global `onError` does NOT set X-Reason on HTTPException without pre-built response (lines 35-37) | Info | This is by design: the global onError handles admin/landing routes. Blossom routes are covered by blossom-router.ts sub-app onError. Not a gap. |

No blockers found. No TODO/FIXME/placeholder patterns. No empty implementations in changed files.

### Human Verification Required

#### 1. PUT /media — 200 success path

**Test:** Send a valid image file (e.g. a 1x1 PNG or a small JPEG) to PUT /media with correct Authorization, Content-Length, Content-Type: image/png, and X-SHA-256 set to the real hash. Ensure sharp and/or FFmpeg is installed.
**Expected:** Response status 200 with a JSON BlobDescriptor containing `sha256`, `size`, `type`, `url`, `uploaded`.
**Why human:** Success path requires real image optimization via sharp/FFmpeg. E2E tests in the test suite only cover error-path status codes. The code path exists (media.ts step 19 `ctx.json(...)`) but no automated test verifies a successful PUT /media end-to-end.

#### 2. Full E2E test suite passes

**Test:** Run `deno test --env-file=.env --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/e2e/media.test.ts tests/e2e/x-reason.test.ts`
**Expected:** 15 tests pass (8 media + 7 x-reason), 0 failed. SUMMARY claims 124 passing, 0 failed for full suite.
**Why human:** Cannot execute Deno tests in the verifier environment. Worker pool uses MessagePorts and requires real filesystem access.

---

## Gaps Summary

No hard gaps found. All modified code artifacts exist, are substantive, and are wired. Key links verified. Anti-pattern scan clean.

**Pending human verification (2 items):**

1. PUT /media 200 success path — no E2E test covers a successful upload with real image optimization. The code path is present but unverified end-to-end.
2. Full test suite execution — SUMMARY claims 124 passing; this needs confirmation by running tests in the actual environment.

**MDIA-06 (507 Insufficient Storage):** Intentionally not implemented per D-01 decision. This matches the Phase 1 approach to UPLD-06. No later milestone phase addresses this. If 507 compliance becomes required, it needs a new implementation decision — not a gap for this phase.

---

_Verified: 2026-04-10_
_Verifier: Claude (gsd-verifier)_
