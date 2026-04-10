# Phase 3: Media Endpoints and Error Format - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-10
**Phase:** 03-media-endpoints-and-error-format
**Areas discussed:** 507 for media, 409/422 mapping, X-Reason audit, HEAD /media codes

---

## 507 for media

| Option | Description | Selected |
|--------|-------------|----------|
| Skip 507 here too (Recommended) | Same rationale as Phase 1 — detecting storage-full isn't valuable for this server. MDIA-06 intentionally not implemented. | ✓ |
| Implement 507 for media | Media files are larger (optimized images/video) so storage exhaustion is more likely. Catch write failures and return 507. | |
| You decide | Claude's discretion based on what makes sense for the codebase | |

**User's choice:** Skip 507 here too
**Notes:** Consistent with Phase 1 decision (D-01). MDIA-06 intentionally not implemented.

---

## 409 mapping (hash mismatch)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse Phase 1 pattern (Recommended) | Worker already posts HASH_MISMATCH errors from Phase 1. The catch block at media.ts:343 just needs to check error type and return 409 instead of generic 400. | ✓ |
| Keep generic 400 | Media endpoint doesn't use X-SHA-256 the same way — hash is verified post-body via x-tags, not during streaming. The worker HASH_MISMATCH may not apply. | |
| You decide | Claude's discretion on how the worker error types map in the media context | |

**User's choice:** Reuse Phase 1 pattern
**Notes:** None

---

## 422 mapping (optimization failure)

| Option | Description | Selected |
|--------|-------------|----------|
| All optimization errors → 422 (Recommended) | If optimizeMedia() throws, the media can't be processed — that's 422 by definition. Whether it's a corrupt file, unsupported codec, or FFmpeg crash, it's unprocessable from the client's perspective. | ✓ |
| Split: corrupt/unsupported → 422, infra → 500 | Distinguish client-fixable errors (bad input) from server-side infra failures (FFmpeg not installed, disk error). Requires classifying error types from optimizeMedia(). | |
| You decide | Claude's discretion on error classification | |

**User's choice:** All optimization errors → 422
**Notes:** No error classification needed — single catch block, simple status code change.

---

## X-Reason audit

| Option | Description | Selected |
|--------|-------------|----------|
| Verify existing coverage (Recommended) | Walk all error paths in all routes, confirm X-Reason is set. Check no code reads X-Reason for branching. Document findings. Light-touch — no code changes expected since errorResponse() and onError already handle it. | ✓ |
| Add X-Reason to success responses too | Some specs include X-Reason on success (e.g., 'Blob already exists' on 200 dedup). Currently only upload.ts:135 does this. Extend to media dedup paths. | |
| You decide | Claude's discretion on audit depth | |

**User's choice:** Verify existing coverage
**Notes:** Light-touch audit, no code changes expected.

---

## HEAD /media codes

| Option | Description | Selected |
|--------|-------------|----------|
| Add Content-Length + Content-Type checks (Recommended) | Mirror what HEAD /upload does (from Phase 1). Check Content-Length against maxSize → 413, check MIME against allowlist → 415. This is what preflight is for — telling clients upfront if their upload will be rejected. | ✓ |
| Keep current behavior | HEAD /media is just a service availability check. Clients should try PUT /media and handle errors. Adding checks complicates a simple endpoint. | |
| You decide | Claude's discretion on preflight behavior | |

**User's choice:** Add Content-Length + Content-Type checks
**Notes:** Mirrors HEAD /upload preflight pattern from Phase 1.

---

## Claude's Discretion

- Error message wording for X-Reason on 409 and 422 responses
- Test structure and organization for Phase 3 endpoint tests
- How to structure the X-Reason audit verification

## Deferred Ideas

None — discussion stayed within phase scope
