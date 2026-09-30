# Phase 1: Request Intake Boundaries - Context

**Gathered:** 2026-09-30 **Status:** Ready for planning

<domain>
## Phase Boundary

Review PRs #53, #54, #62, #63, and #64 against the current server, authoritative Blossom behavior, patch-release scope, and security constraints. Integrate PRs
#53 and #54 on the `v6.4.1` release-candidate branch with focused regression coverage. Later-phase contributions are reviewed and given an explicit integrate,
revise, or defer decision here, but their implementation remains in their assigned phases.

</domain>

<decisions>
## Implementation Decisions

### Envelope rejection surface

- **D-01:** Apply raw-body envelope validation to `PUT /upload`, `HEAD /upload`, `PUT /media`, and `HEAD /media`.
- **D-02:** Run envelope validation before authentication. A request that is both unauthorized and envelope-encoded returns the envelope error.
- **D-03:** Normalize the base MIME type case-insensitively and ignore valid MIME parameters. Reject every `multipart/*` type and
  `application/x-www-form-urlencoded`.
- **D-04:** Return `415 Unsupported Media Type`. `X-Reason` may give ASCII-only, human-readable guidance to send the raw file body, but its exact wording is not
  a machine-readable contract and client software must not depend on it.
- **D-05:** Rejected streaming request bodies must follow the repository's established cancellation semantics and must never be buffered merely to reject them.

### Blob-path grammar and retrieval

- **D-06:** Accept 64-character hexadecimal hashes in either case and normalize them internally.
- **D-07:** After the hash, accept multiple dot-separated extension segments of 1–10 ASCII alphanumeric characters each and allow one trailing slash.
- **D-08:** Reject other suffix text, including quotes, commas, JSON fragments, whitespace, encoded separators, and structurally unsafe content, with the normal
  `404` behavior.
- **D-09:** Extensions are cosmetic. Serve accepted URLs directly using the blob's stored `Content-Type`; never infer response type from the requested suffix,
  redirect for canonicalization, or require the suffix to match stored metadata.

### Static-asset screening

- **D-10:** Allow safe nested paths to reach `serveStatic` so operators can supply nested assets in their own `public` directory.
- **D-11:** Before filesystem access, limit every decoded path segment to 255 characters and the complete decoded path to 2,048 characters.
- **D-12:** Allow ordinary decoded Unicode filenames and spaces. Reject control characters, backslashes, empty or interior dot segments, traversal patterns, and
  unsafe encoded separators.
- **D-13:** A non-candidate bypasses `serveStatic` and continues through normal application routing; unmatched requests receive the application's usual `404`.

### Contribution review and traceability

- **D-14:** Create a dedicated Phase 1 contribution-review document covering PRs #53, #54, #62, #63, and #64.
- **D-15:** Each entry records original intent, affected files and behavior, protocol or security basis, patch-release fit, integrate/revise/defer decision,
  required deviations, regression evidence, and resulting phase and commit linkage.
- **D-16:** Squash each accepted PR into one integration commit on `v6.4.1`.
- **D-17:** Retain the contributor handle and PR number in the review record. Every accepted contribution's pending `CHANGELOG.md` entry must credit its
  contributor so the release notes preserve attribution.

### the agent's Discretion

No implementation decisions were delegated. Planning may choose helper names, module placement, and test organization while preserving the behavior above and
existing repository conventions.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and repository rules

- `.planning/PROJECT.md` — v6.4.1 scope, constraints, selected contributions, and release workflow.
- `.planning/REQUIREMENTS.md` — Phase 1 requirements `INTK-01`, `INTK-02`, `INTK-03`, and `INTK-07`.
- `.planning/ROADMAP.md` — Phase 1 goal and success criteria.
- `AGENTS.md` — repository-wide implementation, testing, changelog, and release-branch rules.
- `ARCHITECTURE.md` — structural invariants and route/storage boundaries.
- `TESTING.md` — required test placement and helper patterns.

### Contribution sources

- `https://github.com/hzrd149/blossom-server/pull/53` — proposed raw-body envelope rejection and incident context.
- `https://github.com/hzrd149/blossom-server/pull/54` — proposed blob-path and static-file screening hardening; adapt its strict single-extension grammar to
  decisions D-06 through D-13.
- `https://github.com/hzrd149/blossom-server/pull/62` — authorization contribution to review in this phase and revise in Phase 2.
- `https://github.com/hzrd149/blossom-server/pull/63` — active-document contribution to review in this phase and integrate in Phase 3.
- `https://github.com/hzrd149/blossom-server/pull/64` — request-logging contribution to review in this phase and integrate in Phase 3.

### Protocol specifications

- `https://github.com/hzrd149/blossom/blob/master/buds/01.md` — canonical blob retrieval paths and response behavior.
- `https://github.com/hzrd149/blossom/blob/master/buds/02.md` — `PUT /upload` raw binary-body and byte-integrity requirements.
- `https://github.com/hzrd149/blossom/blob/master/buds/05.md` — media endpoint behavior.
- `https://github.com/hzrd149/blossom/blob/master/buds/06.md` — upload preflight behavior.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `src/utils/mime.ts`: natural home for normalized envelope-MIME classification shared by upload and media routes.
- `src/utils/url.ts`: existing URL utilities and the contribution's proposed static-candidate helper make this the likely reusable boundary for filesystem
  screening.
- `src/middleware/errors.ts`: existing `errorResponse()` convention supplies protocol error responses and `X-Reason` handling.
- `tests/e2e/upload.test.ts`, `tests/e2e/media.test.ts`, and `tests/e2e/blobs.test.ts`: existing route suites for regression coverage through `app.fetch()`.

### Established Patterns

- Route handlers explicitly enforce auth after parse-only auth middleware; D-02 intentionally places envelope validation before that enforcement for this
  specific rejection.
- Streaming uploads use request-body cancellation on early rejection and must not buffer rejected bodies.
- Specific Blossom endpoints are registered before the broad blob catch-all.
- Blob identity comes from SHA-256 and stored metadata; URL extensions are not authoritative.
- Hono 4.12.7 checks traversal in `serveStatic`, but performs no pre-filesystem length check; its Deno adapter can log non-`NotFound` filesystem errors.

### Integration Points

- `src/routes/upload.ts`: upload PUT and HEAD envelope checks.
- `src/routes/media.ts`: media PUT and HEAD envelope checks.
- `src/routes/blobs.ts`: compatible hash/suffix parsing and stored-content-type retrieval.
- `src/server.ts`: conditional entry into `serveStatic` before normal route processing.
- `CHANGELOG.md`: one credited Unreleased entry for every accepted user-facing contribution.

</code_context>

<specifics>
## Specific Ideas

- Tolerate imperfect but harmless client URLs: multiple ordinary extensions and a trailing slash may still retrieve by hash.
- Separate tolerant blob lookup from strict filesystem admission; the static prefilter owns prevention of unnecessary filesystem operations.
- Treat HTTP `415` as the stable software-visible signal and `X-Reason` only as human guidance.
- Nested public assets are intentional to support an operator-provided `public` directory now or later.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 1-Request Intake Boundaries_ _Context gathered: 2026-09-30_
