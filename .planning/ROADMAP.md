# Roadmap: Blossom Server — HTTP Status Code Update

## Overview

Update all existing endpoint handlers to return the exact HTTP status codes defined in BUD spec PR #98. Three phases follow the natural write/read/media split of the Blossom protocol: first the upload pipeline, then the read-side operations, then the media endpoint and cross-cutting error format. All changes are in-place refinements to existing handlers — no new routes, no new dependencies.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Upload Pipeline** - PUT /upload and HEAD /upload return exact BUD-spec status codes
- [ ] **Phase 2: Read-Side Operations** - GET/HEAD /<sha256>, DELETE, and GET /list return exact status codes
- [ ] **Phase 3: Media Endpoints and Error Format** - PUT/HEAD /media and cross-cutting X-Reason behavior

## Phase Details

### Phase 1: Upload Pipeline
**Goal**: PUT /upload and HEAD /upload return the exact status codes the spec defines for every outcome
**Depends on**: Nothing (first phase)
**Requirements**: UPLD-01, UPLD-02, UPLD-03, UPLD-04, UPLD-05, UPLD-06, PREF-01, PREF-02, PREF-03, PREF-04
**Success Criteria** (what must be TRUE):
  1. PUT /upload responds 201 when a new blob is stored and 200 when it already exists
  2. PUT /upload responds 409 when the X-SHA-256 header does not match the body hash
  3. PUT /upload responds 413, 415, or 507 for oversized, disallowed-type, or storage-full blobs respectively
  4. HEAD /upload responds 200 when the blob is already on the server and 204 when the upload would be accepted
  5. HEAD /upload responds 413 or 415 when the preflight check would be rejected
**Plans:** 2 plans
Plans:
- [x] 01-01-PLAN.md — Expand errorResponse status union and add structured worker error types
- [x] 01-02-PLAN.md — Update PUT/HEAD /upload status codes and E2E tests

### Phase 2: Read-Side Operations
**Goal**: GET /<sha256>, HEAD /<sha256>, DELETE /<sha256>, and GET /list/<pubkey> return the exact status codes the spec defines for every outcome
**Depends on**: Phase 1
**Requirements**: RETR-01, RETR-02, RETR-03, RETR-04, RETR-05, RETR-06, DELT-01, DELT-02, LIST-01, LIST-02
**Success Criteria** (what must be TRUE):
  1. GET /<sha256> responds 200 for a full response and 206 for a valid Range request
  2. GET /<sha256> responds 404 when the blob does not exist and 416 for an invalid byte range
  3. HEAD /<sha256> responds 200 with metadata headers and no body, or 404 when the blob does not exist
  4. DELETE /<sha256> responds 200 (with body) or 204 (without body) on success and 404 when the blob does not exist
  5. GET /list/<pubkey> responds 200 with a blob descriptor array and 400 for malformed query parameters
**Plans:** 2 plans
Plans:
- [x] 02-01-PLAN.md — DELETE status code change (200 to 204) and E2E tests
- [x] 02-02-PLAN.md — Verify GET/HEAD blob retrieval and GET /list status codes with E2E tests

### Phase 3: Media Endpoints and Error Format
**Goal**: PUT /media and HEAD /media return exact spec status codes, and all error responses use X-Reason as a diagnostic-only header
**Depends on**: Phase 2
**Requirements**: MDIA-01, MDIA-02, MDIA-03, MDIA-04, MDIA-05, MDIA-06, MDPF-01, MDPF-02, MDPF-03, ERRF-01, ERRF-02
**Success Criteria** (what must be TRUE):
  1. PUT /media responds 200 on success, 409 for hash mismatch, 422 when media cannot be processed
  2. PUT /media responds 413, 415, or 507 for oversized, disallowed-type, or storage-full uploads respectively
  3. HEAD /media responds 200 when acceptable, 413 or 415 when rejected
  4. Every error response includes an X-Reason header with a human-readable diagnostic string
  5. No code path uses X-Reason for conditional logic or control flow
**Plans:** 2 plans
Plans:
- [x] 03-01-PLAN.md — PUT /media status codes (409, 422) + HEAD /media preflight validation + E2E tests
- [x] 03-02-PLAN.md — X-Reason audit and cross-endpoint verification tests

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Upload Pipeline | 0/2 | Not started | - |
| 2. Read-Side Operations | 0/2 | Not started | - |
| 3. Media Endpoints and Error Format | 0/2 | Not started | - |
