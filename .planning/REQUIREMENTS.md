# Requirements: Blossom Server — HTTP Status Code Update

**Defined:** 2026-04-09
**Core Value:** Every endpoint returns the exact HTTP status codes specified in the updated BUD specs

## v1 Requirements

Requirements for this update. Each maps to roadmap phases.

### Upload (PUT /upload)

- [ ] **UPLD-01**: PUT /upload returns 201 Created when a new blob is stored successfully
- [ ] **UPLD-02**: PUT /upload returns 200 OK when the blob already exists
- [ ] **UPLD-03**: PUT /upload returns 409 Conflict when X-SHA-256 header doesn't match request body hash
- [ ] **UPLD-04**: PUT /upload returns 413 Content Too Large when blob exceeds server size limits
- [ ] **UPLD-05**: PUT /upload returns 415 Unsupported Media Type when blob type is not allowed
- [ ] **UPLD-06**: PUT /upload returns 507 Insufficient Storage when server cannot store the blob

### Upload Preflight (HEAD /upload)

- [ ] **PREF-01**: HEAD /upload returns 200 OK when the blob already exists on the server
- [ ] **PREF-02**: HEAD /upload returns 204 No Content when the upload would be accepted
- [ ] **PREF-03**: HEAD /upload returns 413 Content Too Large when blob would exceed size limits
- [ ] **PREF-04**: HEAD /upload returns 415 Unsupported Media Type when blob type is not supported

### Retrieval (GET/HEAD /<sha256>)

- [ ] **RETR-01**: GET /<sha256> returns 200 OK with blob in response body
- [ ] **RETR-02**: GET /<sha256> returns 206 Partial Content for valid Range requests
- [ ] **RETR-03**: GET /<sha256> returns 404 Not Found when blob does not exist
- [ ] **RETR-04**: GET /<sha256> returns 416 Range Not Satisfiable for invalid byte ranges
- [ ] **RETR-05**: HEAD /<sha256> returns 200 OK with metadata headers and no body
- [ ] **RETR-06**: HEAD /<sha256> returns 404 Not Found when blob does not exist

### Delete (DELETE /<sha256>)

- [ ] **DELT-01**: DELETE /<sha256> returns 200 OK or 204 No Content on successful deletion
- [ ] **DELT-02**: DELETE /<sha256> returns 404 Not Found when blob does not exist

### List (GET /list/<pubkey>)

- [ ] **LIST-01**: GET /list/<pubkey> returns 200 OK with array of blob descriptors
- [ ] **LIST-02**: GET /list/<pubkey> returns 400 Bad Request for malformed query parameters

### Media (PUT /media)

- [ ] **MDIA-01**: PUT /media returns 200 OK when media is accepted, processed, and stored
- [ ] **MDIA-02**: PUT /media returns 409 Conflict when X-SHA-256 doesn't match request body
- [ ] **MDIA-03**: PUT /media returns 413 Content Too Large when media exceeds size limits
- [ ] **MDIA-04**: PUT /media returns 415 Unsupported Media Type when media type is not supported
- [ ] **MDIA-05**: PUT /media returns 422 Unprocessable Content when media cannot be processed
- [ ] **MDIA-06**: PUT /media returns 507 Insufficient Storage when server cannot store processed media

### Media Preflight (HEAD /media)

- [ ] **MDPF-01**: HEAD /media returns 200 OK when the request is acceptable
- [ ] **MDPF-02**: HEAD /media returns 413 Content Too Large when media would exceed size limits
- [ ] **MDPF-03**: HEAD /media returns 415 Unsupported Media Type when media type is not supported

### Error Response Format

- [ ] **ERRF-01**: All error responses include X-Reason header with human-readable diagnostic message
- [ ] **ERRF-02**: X-Reason is treated as diagnostic only, not used for control flow

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Rate Limiting

- **RATE-01**: Endpoints return 429 Too Many Requests when rate limits are exceeded
- **RATE-02**: Server implements configurable rate limiting per endpoint

### Service Availability

- **AVAIL-01**: Endpoints return 503 Service Unavailable when services are temporarily down

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rate limiting implementation (429) | Only return 429 if rate limiting exists; implementing rate limiting itself is separate work |
| Payment integration (402) | BUD-07 payment flow is a separate feature; just return 402 if payment logic exists |
| Redirect support (307/308) | Redirect logic depends on CDN/proxy configuration, not status code compliance |
| Client-side changes | Clients already check 2xx range; changes are backwards compatible |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| UPLD-01 | Pending | Pending |
| UPLD-02 | Pending | Pending |
| UPLD-03 | Pending | Pending |
| UPLD-04 | Pending | Pending |
| UPLD-05 | Pending | Pending |
| UPLD-06 | Pending | Pending |
| PREF-01 | Pending | Pending |
| PREF-02 | Pending | Pending |
| PREF-03 | Pending | Pending |
| PREF-04 | Pending | Pending |
| RETR-01 | Pending | Pending |
| RETR-02 | Pending | Pending |
| RETR-03 | Pending | Pending |
| RETR-04 | Pending | Pending |
| RETR-05 | Pending | Pending |
| RETR-06 | Pending | Pending |
| DELT-01 | Pending | Pending |
| DELT-02 | Pending | Pending |
| LIST-01 | Pending | Pending |
| LIST-02 | Pending | Pending |
| MDIA-01 | Pending | Pending |
| MDIA-02 | Pending | Pending |
| MDIA-03 | Pending | Pending |
| MDIA-04 | Pending | Pending |
| MDIA-05 | Pending | Pending |
| MDIA-06 | Pending | Pending |
| MDPF-01 | Pending | Pending |
| MDPF-02 | Pending | Pending |
| MDPF-03 | Pending | Pending |
| ERRF-01 | Pending | Pending |
| ERRF-02 | Pending | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 0
- Unmapped: 31 ⚠️

---
*Requirements defined: 2026-04-09*
*Last updated: 2026-04-09 after initial definition*
