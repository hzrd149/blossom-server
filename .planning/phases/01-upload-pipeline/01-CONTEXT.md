# Phase 1: Upload Pipeline - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

PUT /upload and HEAD /upload return the exact HTTP status codes defined in the BUD spec for every outcome. This is an in-place refinement of existing handlers — no new routes, no new dependencies.

</domain>

<decisions>
## Implementation Decisions

### 507 Insufficient Storage
- **D-01:** Skip 507 implementation entirely. The server will NOT detect or return 507 Insufficient Storage. This does not provide value for the server or client. Requirement UPLD-06 is intentionally not implemented.

### Hash Mismatch (409 Conflict)
- **D-02:** Worker must post back structured/typed error objects (e.g. `{ id, error: 'HASH_MISMATCH', message }`) instead of plain error strings. The main thread maps error types to specific HTTP status codes — `HASH_MISMATCH` → 409 Conflict.
- **D-03:** PUT /upload returns 409 Conflict when X-SHA-256 header does not match the computed body hash. The X-Reason header contains the diagnostic message from the worker.

### Status Code Changes (PUT /upload)
- **D-04:** PUT /upload returns 201 Created when a new blob is stored (currently returns 200). The `ctx.json(...)` call at the end of a successful new upload must explicitly set status 201.
- **D-05:** PUT /upload returns 200 OK when the blob already exists (dedup path). This is already the current behavior — no change needed, but make it explicit.

### Status Code Changes (HEAD /upload)
- **D-06:** HEAD /upload returns 200 OK when the blob already exists on the server (with X-SHA-256 provided and blob found). Currently correct.
- **D-07:** HEAD /upload returns 204 No Content when the upload would be accepted (blob does not exist or no X-SHA-256 provided). Currently returns 200 — must change to 204.

### Error Response Helper
- **D-08:** Expand the `errorResponse()` status union type in `src/middleware/errors.ts` to include all status codes needed across all three phases (409, 416, 422, 507) in Phase 1. This avoids touching the helper in Phase 2 and Phase 3.

### Claude's Discretion
- Error message wording for X-Reason headers on new status codes (409, etc.)
- Internal refactoring approach for worker error types (exact type shape, enum vs string literals)
- Whether to add explicit 200 status to the dedup path `ctx.json()` call or leave it as default

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs checked into the repo — requirements fully captured in decisions above and in:

### Project Requirements
- `.planning/REQUIREMENTS.md` — Full requirement definitions (UPLD-01 through UPLD-06, PREF-01 through PREF-04)
- `.planning/ROADMAP.md` — Phase 1 success criteria and scope

### Key Source Files
- `src/routes/upload.ts` — PUT /upload and HEAD /upload handlers (primary modification target)
- `src/middleware/errors.ts` — `errorResponse()` helper (status union type expansion)
- `src/workers/upload-worker.ts` — Worker script (hash mismatch error posting)
- `src/workers/pool.ts` — Worker pool dispatch (error message handling)
- `src/routes/blossom-router.ts` — Blossom sub-app onError handler (may need 409 in error formatting)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `errorResponse()` in `src/middleware/errors.ts` — already used for all error responses with X-Reason header
- `getFileRule()` in `src/prune/rules.ts` — upload gate for MIME type and pubkey checks (already returns null → 415)
- Worker pool dispatch pattern in `src/workers/pool.ts` — existing job dispatch with promise-based result

### Established Patterns
- Two-phase write: `beginWrite()` → worker writes to tmpPath → `commitWrite()` or `abortWrite()`
- Worker errors caught in try/catch block at `upload.ts:347-363` and returned as `errorResponse(ctx, 400, msg)`
- BUD-01 compliant error handler in `blossom-router.ts:39-52` converts HTTPException to text/plain + X-Reason

### Integration Points
- Worker → main thread communication via `postMessage()` with `{ id, hash, size }` success or `{ id, error }` failure
- `errorResponse()` called from multiple route handlers — union type change affects all callers (safe since we're adding codes, not removing)

</code_context>

<specifics>
## Specific Ideas

- UPLD-06 (507 Insufficient Storage) is intentionally skipped — user decision, not an oversight
- Worker error objects should be typed/structured (not string matching) for clean status code mapping

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-upload-pipeline*
*Context gathered: 2026-04-09*
