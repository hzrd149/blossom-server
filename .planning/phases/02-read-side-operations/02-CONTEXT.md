# Phase 2: Read-Side Operations - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

GET /<sha256>, HEAD /<sha256>, DELETE /<sha256>, and GET /list/<pubkey> return the exact HTTP status codes defined in the BUD spec for every outcome. This is an in-place refinement of existing handlers — no new routes, no new dependencies.

</domain>

<decisions>
## Implementation Decisions

### DELETE Response (DELETE /<sha256>)
- **D-01:** DELETE returns 204 No Content (with no body) for all successful deletions — both when only ownership is removed and when the blob is fully purged. Currently returns `ctx.body(null, 200)` in both paths; change status to 204.
- **D-02:** DELETE returns 404 Not Found when the blob does not exist. This is already the current behavior — no change needed.

### GET/HEAD Retrieval (GET/HEAD /<sha256>)
- **D-03:** GET /<sha256> returns 200 for full responses, 206 for valid Range requests, 416 for invalid ranges, and 404 when the blob doesn't exist. All of these are already correctly implemented in `src/routes/blobs.ts` — no status code changes needed.
- **D-04:** HEAD /<sha256> returns 200 with metadata headers and no body, or 404 when the blob doesn't exist. Already correctly implemented — no changes needed.
- **D-05:** GET /<sha256> returns 304 Not Modified for conditional requests (If-None-Match). This is not explicitly in the spec requirements but is valid HTTP caching behavior — keep as-is.

### List Endpoint (GET /list/<pubkey>)
- **D-06:** GET /list/<pubkey> returns 200 with a JSON array of blob descriptors. Already correctly implemented — no changes needed.
- **D-07:** GET /list/<pubkey> returns 400 for malformed query parameters (limit, since, until, cursor). Current per-parameter validation with specific error messages is already compliant — keep as-is.
- **D-08:** GET /list/<pubkey> returns 404 when the endpoint is disabled, 401 when auth is required but missing, and 403 when listing others' blobs is not allowed. These are not in the spec requirements but are standard HTTP semantics — keep as-is, no changes needed.

### Claude's Discretion
- Error message wording for X-Reason on the 204→200 change in DELETE (if any diagnostic messaging is relevant)
- Test structure and organization for Phase 2 endpoint tests

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Requirements
- `.planning/REQUIREMENTS.md` — Full requirement definitions (RETR-01 through RETR-06, DELT-01, DELT-02, LIST-01, LIST-02)
- `.planning/ROADMAP.md` — Phase 2 success criteria and scope

### Prior Phase Context
- `.planning/phases/01-upload-pipeline/01-CONTEXT.md` — Phase 1 decisions (errorResponse expansion, worker error patterns)

### Key Source Files
- `src/routes/blobs.ts` — GET/HEAD /<sha256> handlers (primary review target, likely no changes needed)
- `src/routes/delete.ts` — DELETE /<sha256> handler (change 200 → 204 for successful deletions)
- `src/routes/list.ts` — GET /list/<pubkey> handler (review target, likely no changes needed)
- `src/middleware/errors.ts` — `errorResponse()` helper (already expanded in Phase 1, no changes needed)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `errorResponse()` in `src/middleware/errors.ts` — already has all needed status codes in the union type (expanded in Phase 1)
- `parseRange()` in `src/routes/blobs.ts` — existing range parser, correctly handles bytes=start-end, suffix, and open ranges

### Established Patterns
- Route handlers return `ctx.body(reason, status, headers)` for errors and `ctx.body(null, status)` or `ctx.json(data)` for success
- BUD-01 compliant error handler in `blossom-router.ts` converts HTTPException to text/plain + X-Reason
- `errorResponse()` always sets X-Reason header on error responses

### Integration Points
- DELETE handler at `src/routes/delete.ts:87` and `:99` — two `ctx.body(null, 200)` calls need status changed to 204
- All other endpoints already return correct status codes — changes are minimal

</code_context>

<specifics>
## Specific Ideas

- Phase 2 is primarily a verification phase — most status codes are already correct
- The only actual code change is DELETE 200 → 204 (two lines in `src/routes/delete.ts`)
- GET/HEAD and List endpoints need test coverage to verify existing correct behavior

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-read-side-operations*
*Context gathered: 2026-04-09*
