# Phase 3: Media Endpoints and Error Format - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

PUT /media and HEAD /media return the exact HTTP status codes defined in the BUD spec for every outcome, and all error responses across the server use X-Reason as a diagnostic-only header. This is an in-place refinement of existing handlers — no new routes, no new dependencies.

</domain>

<decisions>
## Implementation Decisions

### 507 Insufficient Storage
- **D-01:** Skip 507 implementation for PUT /media, same as Phase 1's decision for PUT /upload. The server will NOT detect or return 507 Insufficient Storage for media uploads. Requirement MDIA-06 is intentionally not implemented.

### Hash Mismatch (409 Conflict)
- **D-02:** Reuse the Phase 1 structured worker error pattern. The worker already posts `HASH_MISMATCH` typed errors. The catch block at `media.ts:343-348` needs to check the error type and return 409 Conflict instead of the current generic 400.

### Optimization Failure (422 Unprocessable Content)
- **D-03:** ALL optimization failures from `optimizeMedia()` become 422 Unprocessable Content. No distinction between corrupt input, unsupported codec, or infrastructure failures — from the client's perspective, the media cannot be processed. Change the catch block at `media.ts:420-427` from 500 to 422.

### HEAD /media Preflight
- **D-04:** Add Content-Length and Content-Type validation to HEAD /media, mirroring HEAD /upload's preflight behavior from Phase 1. Check Content-Length against `config.media.maxSize` → 413 Content Too Large. Check MIME type against storage rules allowlist → 415 Unsupported Media Type.

### X-Reason Audit
- **D-05:** Verify existing X-Reason coverage across all error paths in all routes. Confirm no code reads X-Reason for branching/control flow. Document findings. Light-touch audit — no code changes expected since `errorResponse()` and blossom-router's `onError` already set X-Reason on all error responses.

### Claude's Discretion
- Error message wording for X-Reason on 409 and 422 responses
- Test structure and organization for Phase 3 endpoint tests
- How to structure the X-Reason audit verification (tests vs code review)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Requirements
- `.planning/REQUIREMENTS.md` — Full requirement definitions (MDIA-01 through MDIA-06, MDPF-01 through MDPF-03, ERRF-01, ERRF-02)
- `.planning/ROADMAP.md` — Phase 3 success criteria and scope

### Prior Phase Context
- `.planning/phases/01-upload-pipeline/01-CONTEXT.md` — Phase 1 decisions (507 skip, worker error types, errorResponse expansion)
- `.planning/phases/02-read-side-operations/02-CONTEXT.md` — Phase 2 decisions (DELETE 204, verification patterns)

### Key Source Files
- `src/routes/media.ts` — PUT /media and HEAD /media handlers (primary modification target)
- `src/middleware/errors.ts` — `errorResponse()` helper (already has all needed status codes from Phase 1)
- `src/routes/blossom-router.ts` — Blossom sub-app onError handler (X-Reason formatting)
- `src/workers/pool.ts` — Worker pool (structured error types from Phase 1)
- `src/workers/upload-worker.ts` — Worker script (HASH_MISMATCH error type)
- `src/optimize/index.ts` — `optimizeMedia()` function (error source for 422)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `errorResponse()` in `src/middleware/errors.ts` — already has 409, 422, 413, 415 in union type (expanded in Phase 1)
- Worker structured error pattern from Phase 1 — `HASH_MISMATCH` error type already posted by worker
- HEAD /upload preflight pattern from Phase 1 — Content-Length and Content-Type validation logic to mirror

### Established Patterns
- PUT /media pipeline follows same worker-dispatch pattern as PUT /upload (beginWrite → worker → result)
- Worker errors caught at `media.ts:343-348` — currently returns generic `errorResponse(ctx, 400, msg)`
- Optimization errors caught at `media.ts:420-427` — currently returns `errorResponse(ctx, 500, msg)`
- X-Reason set by `errorResponse()` on all error paths and by `blossom-router.ts` onError for HTTPExceptions

### Integration Points
- Worker → main thread: same `{ id, error }` failure messages with typed error objects from Phase 1
- `optimizeMedia()` throws on failure — single catch block, no error classification needed (all → 422)
- HEAD /media handler at `media.ts:142-174` — needs Content-Length and Content-Type checks added before the 200 return

</code_context>

<specifics>
## Specific Ideas

- MDIA-06 (507 Insufficient Storage) is intentionally skipped — consistent with Phase 1 decision (D-01)
- 409 handling reuses Phase 1's worker structured error pattern — no new error types needed
- 422 is a simple status code change from 500 in the optimization catch block
- HEAD /media preflight mirrors HEAD /upload pattern — same validation logic, different config values (media.maxSize vs upload limits)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-media-endpoints-and-error-format*
*Context gathered: 2026-04-10*
