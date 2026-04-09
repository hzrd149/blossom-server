---
phase: 01-upload-pipeline
reviewed: 2026-04-09T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/middleware/errors.ts
  - src/workers/upload-worker.ts
  - src/workers/pool.ts
  - src/routes/upload.ts
  - tests/e2e/upload.test.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Five files were reviewed covering the upload pipeline HTTP status code changes (BUD-02/BUD-06). The status code additions to `errorResponse`, the `WorkerErrorType` discriminated union in the worker, and the 201/409 mappings in the route handler are all sound in design. However, one critical compile-time error was introduced: `WorkerJobError` is declared twice in `pool.ts`, which will prevent the TypeScript module from compiling. Three additional warnings cover a dead `WRITE_ERROR` type member, a stale 400 fallback that should be 500 for server-side write failures, and a `jobCount` leak in the worker `onerror` handler. One info item notes a spec-ambiguous 200 vs 201 on the dedup fast-path.

---

## Critical Issues

### CR-01: Duplicate `WorkerJobError` class declaration in pool.ts

**File:** `src/workers/pool.ts:64`
**Issue:** `WorkerJobError` is declared twice as an exported class — once at line 45 and again at line 64. This is a hard compile error in TypeScript (`Duplicate identifier 'WorkerJobError'`). The module will fail to load at runtime under Deno's strict TypeScript type-checker, breaking the entire upload pipeline. The two declarations are byte-for-byte identical; one was left in after a refactor.

**Fix:** Delete the second declaration (lines 59–71 including its JSDoc):

```typescript
// REMOVE lines 59–71 entirely — keep only the first declaration at lines 44–52
```

The surviving declaration at lines 44–52 is sufficient and already has a JSDoc comment. The JSDoc from the removed block ("The errorType field carries a discriminant string...") can optionally be merged into the surviving block's comment for completeness.

---

## Warnings

### WR-01: `WRITE_ERROR` is a dead member of the `WorkerErrorType` union

**File:** `src/workers/upload-worker.ts:100`
**Issue:** The `WorkerErrorType` union includes `"WRITE_ERROR"` but the worker never emits it. The `catch` block at lines 215–227 always posts `errorType: "UNKNOWN"` for all I/O failures, including disk-write errors. `upload.ts` also never checks for `"WRITE_ERROR"`, so the discriminant provides no routing benefit and creates misleading documentation.

Either the member should be used (and routed to 507 Insufficient Storage in `upload.ts` as the union implies), or it should be removed to keep the type honest.

**Fix (emit and handle):**
```typescript
// upload-worker.ts — in the catch block, distinguish write errors:
self.postMessage({
  id,
  error: err instanceof Error ? err.message : String(err),
  errorType: err instanceof Deno.errors.NoSpace ? "WRITE_ERROR" : "UNKNOWN",
} satisfies JobError);
```

```typescript
// upload.ts — extend the error handler in step 9:
if (err instanceof WorkerJobError && err.errorType === "HASH_MISMATCH") {
  return errorResponse(ctx, 409, msg);
}
if (err instanceof WorkerJobError && err.errorType === "WRITE_ERROR") {
  return errorResponse(ctx, 507, msg);
}
return errorResponse(ctx, 500, msg);
```

**Fix (remove the dead member):**
```typescript
// upload-worker.ts line 100:
type WorkerErrorType = "HASH_MISMATCH" | "UNKNOWN";
```

### WR-02: Worker catch-all error falls back to 400 instead of 500

**File:** `src/routes/upload.ts:365`
**Issue:** When the worker rejects with an error that is not `HASH_MISMATCH`, the handler returns `errorResponse(ctx, 400, msg)`. A 400 (Bad Request) implies client error. Write failures (disk full, permission denied, etc.) that reach this branch are server-side faults and should return 500 (or 507 for storage-full). Returning 400 causes BUD clients to interpret server I/O errors as malformed requests and not retry.

**Fix:**
```typescript
// upload.ts line 363–365 — change the fallback status:
if (err instanceof WorkerJobError && err.errorType === "HASH_MISMATCH") {
  return errorResponse(ctx, 409, msg);
}
return errorResponse(ctx, 500, msg);
```

### WR-03: `worker.onerror` decrements `jobCount` by at most 1 regardless of in-flight job count

**File:** `src/workers/pool.ts:180`
**Issue:** When a worker crashes (`onerror` fires), `jobCount` is decremented by 1, but a single worker can have up to `maxJobsPerWorker` concurrent jobs. Any jobs beyond the first one leak their slot permanently — `jobCount` never reaches 0 again, and the worker appears perpetually full to `available` and `dispatch()`. Over time this causes the pool to starve even though workers are idle.

The comment acknowledges "We don't know which job failed" but the correct safe fallback is to reset `jobCount` to 0 (drain all slots), not to drain only one.

**Fix:**
```typescript
worker.onerror = (event) => {
  console.error(`Upload worker ${i} error:`, event.message);
  // Reset to 0 — we cannot know which jobs failed, so free all slots.
  state.jobCount = 0;
};
```

Additionally, any pending jobs in `this.pending` whose IDs belong to this worker will hang indefinitely because the worker is dead and will never post a result. Consider rejecting all pending promises for this worker's jobs in the `onerror` handler, or marking the worker as dead and terminating/replacing it.

---

## Info

### IN-01: Dedup fast-path returns 200 instead of 201 on PUT /upload

**File:** `src/routes/upload.ts:278`
**Issue:** When a PUT /upload request hits the dedup path (blob already exists), `ctx.json(descriptor)` is called without an explicit status code, defaulting to 200. New uploads return 201. The test at `tests/e2e/upload.test.ts:596` asserts 200 for the dedup case. If the BUD-02 spec requires 201 for all successful blob responses (whether stored or deduped), both the implementation and the test would need updating to `ctx.json(descriptor, 201)`. If 200 is intentional to signal "already existed — no new resource created", the distinction is reasonable but should be documented in the JSDoc or inline comment.

**Fix (if 201 is required by spec):**
```typescript
// upload.ts line 278 — add explicit 201 status:
return ctx.json(
  { url: ..., sha256: ..., size: ..., type: ..., uploaded: ... } satisfies BlobDescriptor,
  201,
);
```

And update `tests/e2e/upload.test.ts:596`:
```typescript
assertEquals(res2.status, 201);
```

---

_Reviewed: 2026-04-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
