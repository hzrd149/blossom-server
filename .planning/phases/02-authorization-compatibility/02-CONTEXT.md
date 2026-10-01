# Phase 2: Authorization Compatibility - Context

**Gathered:** 2026-10-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate the safe parts of PR #62 so protected upload and delete operations require correctly scoped BUD-11 authorization, expiration values are strictly validated, and valid future expirations remain accepted without an invented lifetime cap. Preserve compatibility for otherwise valid existing Blossom clients.

</domain>

<decisions>
## Implementation Decisions

### BUD-11 hash scoping
- Upload and delete operations that act on a known blob hash require an `x` tag matching that hash.
- Reject missing `x` tags when the operation requires blob-hash scope; open authorization tokens must not authorize those operations.
- With multiple `x` tags, accept the authorization when at least one tag exactly matches the requested lowercase SHA-256 hash.
- Report a missing or mismatched required blob scope as `403 Forbidden` through the existing `HTTPException` path.

### Expiration validation
- Accept only a complete base-10 integer string as an expiration value; do not accept prefixes through permissive `parseInt` behavior.
- Reject malformed and unsafe expiration values with `400 Bad Request`.
- Treat an expiration earlier than the current Unix timestamp as expired.
- Do not impose a maximum future lifetime. Any valid future expiration remains acceptable, including values more than 30 days away.

### Compatibility and regression coverage
- Keep expiration parsing centralized in `parseAuthEvent()`.
- Adapt only PR #62's safe behavior and avoid unrelated authentication refactors.
- Add unit coverage for strict expiration parsing and required `x`-tag enforcement, plus focused protected-route regression tests.
- Preserve current Base64 compatibility, server-tag behavior, signature verification, and unrestricted valid future expirations for existing clients.

### the agent's Discretion
Planning may choose helper names and exact test organization while preserving the decisions above and repository conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/middleware/auth.ts` already centralizes BUD-11 parsing in `parseAuthEvent()` and blob scoping in `requireXTag()`.
- `tests/unit/auth.test.ts` already uses real signed Nostr events and directly covers parsing, `requireAuth()`, and `requireXTag()`.
- `tests/e2e/upload.test.ts`, `tests/e2e/delete.test.ts`, and `tests/e2e/media.test.ts` contain protected-route helpers and established authorization assertions.

### Established Patterns
- Authentication middleware parses but does not enforce; every protected route explicitly calls `requireAuth()` and, where applicable, `requireXTag()`.
- Auth failures use `HTTPException`, with malformed events mapped to `400`, missing authentication to `401`, and incorrect authorization scope to `403`.
- Regression tests construct and sign real kind-24242 Nostr events using `nostr-tools/pure`.

### Integration Points
- `src/middleware/auth.ts`: strict expiration parsing and required blob-hash scope.
- Protected upload and delete route handlers: ensure required `x`-tag enforcement is applied with the actual requested hash.
- `tests/unit/auth.test.ts` and focused route suites: cover malformed, expired, long-lived, missing, mismatched, and matching values.
- `CHANGELOG.md`: credit PR #62's contributor in the Unreleased patch notes.

</code_context>

<specifics>
## Specific Ideas

- Preserve the protocol-required distinction between authentication and authorization: structurally invalid events are bad requests, while valid events lacking the required blob scope are forbidden.
- Separate PR #62's desirable strictness from its undocumented 30-day policy.

</specifics>

<deferred>
## Deferred Ideas

- Any configurable or fixed authorization lifetime policy remains out of scope and requires separate protocol and product design.

</deferred>
