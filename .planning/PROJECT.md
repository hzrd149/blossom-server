# Blossom Server — HTTP Status Code Update

## What This Is

Update the blossom-server to comply with the new HTTP status code definitions proposed in [hzrd149/blossom#98](https://github.com/hzrd149/blossom/pull/98). The server currently returns generic `2xx`/`4xx` codes; the new spec defines exact status codes for every endpoint to improve interoperability between clients and servers.

## Core Value

Every endpoint returns the exact HTTP status codes specified in the updated BUD specs, enabling clients and AI agents to understand server behavior from status codes alone.

## Requirements

### Validated

- ✓ BUD-01 GET/HEAD `/<sha256>` endpoints — existing
- ✓ BUD-02 PUT `/upload` endpoint — existing
- ✓ BUD-05 PUT `/media` and HEAD `/media` endpoints — existing
- ✓ BUD-06 HEAD `/upload` endpoint — existing
- ✓ BUD-02 GET `/list/<pubkey>` endpoint — existing
- ✓ BUD-02 DELETE `/<sha256>` endpoint — existing
- ✓ BUD-11 Authorization — existing
- ✓ PUT /upload returns 201 Created for new blobs, 200 OK for existing blobs — Validated in Phase 1: Upload Pipeline
- ✓ HEAD /upload returns 200 OK if blob exists, 204 No Content if upload would be accepted — Validated in Phase 1: Upload Pipeline
- ✓ PUT /upload returns 409 Conflict when X-SHA-256 doesn't match body — Validated in Phase 1: Upload Pipeline
- ✓ PUT /upload returns 411 Length Required when Content-Length missing — Validated in Phase 1: Upload Pipeline
- ✓ PUT /upload returns 413 Content Too Large for oversized blobs — Validated in Phase 1: Upload Pipeline
- ✓ PUT /upload returns 415 Unsupported Media Type for rejected MIME types — Validated in Phase 1: Upload Pipeline

### Active

- [ ] PUT /upload returns 507 Insufficient Storage when server can't store
- [ ] GET /<sha256> returns correct status codes (200, 206, 307/308, 400, 401, 403, 404, 416, 429, 503)
- [ ] HEAD /<sha256> returns correct status codes (200, 307/308, 400, 401, 403, 404, 429, 503)
- [ ] DELETE /<sha256> returns 200 OK with body or 204 No Content without body
- [ ] GET /list/<pubkey> returns correct status codes per BUD-12
- [ ] PUT /media returns correct status codes (200, 400, 401, 403, 409, 411, 413, 415, 422, 429, 503, 507)
- [ ] HEAD /media returns correct status codes (200, 400, 401, 403, 411, 413, 415, 429, 503)
- [ ] X-Reason header used as human-readable diagnostic only (no control flow)

### Out of Scope

- Client-side changes — clients already check 2xx range, this is backwards compatible
- New endpoint paths — the BUD-02/BUD-12 split is organizational in the spec, not a server routing change
- Rate limiting (429) — implementation of rate limiting itself is out of scope; just return 429 if/when rate limiting exists
- Payment integration (402) — just return 402 if/when payment is required

## Context

- The server is a Deno/Hono TypeScript application implementing the Blossom protocol (BUD-01 through BUD-11)
- Routes are organized in `src/routes/` with one file per BUD operation
- Error responses use an `errorResponse()` helper and Hono's `HTTPException`
- The blossom sub-app has its own `onError` handler returning `text/plain` with `X-Reason` header
- This is a brownfield update — all endpoints exist, we're refining their status codes
- PR #98 also moves `/list` and `DELETE` from BUD-02 to new BUD-12, but the server routes don't need restructuring since they're not organized by BUD number

## Constraints

- **Backwards compatibility**: All changes must be transparent to existing clients that check `2xx` range
- **Spec compliance**: Status codes must match the tables in PR #98 exactly
- **Tech stack**: Deno + Hono + TypeScript — no stack changes
- **No new dependencies**: This is purely status code refinement in existing handlers

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Status code changes only, no route reorganization | Server routes aren't organized by BUD number, so the BUD-02/BUD-12 spec split doesn't map to code structure | Confirmed |
| HEAD /upload 204 for "accepted" | New spec defines 204 No Content instead of 200 OK for "upload would be accepted"; backwards compatible since clients check 2xx | Implemented in Phase 1 |
| PUT /upload 201 for new blobs | New spec distinguishes new (201) vs existing (200) uploads; backwards compatible | Implemented in Phase 1 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-09 after Phase 1 completion — Upload Pipeline*
