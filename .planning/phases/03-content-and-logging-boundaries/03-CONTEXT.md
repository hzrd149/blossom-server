---
phase: 03-content-and-logging-boundaries
status: discussed
discussed: 2026-10-01
requirements: [INTK-05, INTK-06]
---

# Phase 3: Content and Logging Boundaries — Context

## Phase Goal

As a Blossom server operator, I want to isolate active uploaded documents from the application origin and strip query data from request logs, so that hosted blobs and operational logs cannot expose users or secrets.

## Decisions

### Active MIME boundary

- Normalize stored MIME values by trimming parameters and folding case.
- Treat `text/html`, `text/xml`, `application/xml`, and every subtype ending in `+xml` as active content.
- This classification covers HTML, XHTML, SVG, XSLT, and other XML-derived formats.
- Stored MIME metadata is authoritative. Requested filename extensions are cosmetic and must not influence classification.

### Response header coverage

- Add `Content-Disposition: attachment` only for active content.
- Add `X-Content-Type-Options: nosniff` to every successful blob representation.
- Apply applicable hardening consistently to full GET, HEAD, range `206`, and conditional `304` responses.
- Ordinary media must remain inline and retain existing range and conditional behavior.

### Attachment filenames

- Derive attachment filenames from the normalized content hash plus a safe extension derived from stored MIME metadata.
- Fall back to the bare hash when no safe extension is available.
- Never use the requested cosmetic suffix as filename or security-policy authority.

### Query-free logging

- Log the URL parser's serialized `pathname` in both request and response lines.
- Preserve the percent-encoded pathname form.
- Omit the query component entirely; do not retain parameter names or values.
- Preserve method, status, timing, `X-Reason`, and existing error context.

## Compatibility Constraints

- Do not force ordinary non-active media to download.
- Do not break GET, HEAD, range, or conditional blob retrieval semantics.
- Do not decode or otherwise rewrite logged paths beyond using the serialized pathname.
- Do not allow URL suffixes to override stored blob metadata.
- Keep this phase limited to the accepted PR #63 and PR #64 hardening behavior.

## Research Needs

- Confirm the response-header matrix against authoritative HTTP/browser behavior, especially `304` metadata and `nosniff` semantics.
- Adapt PRs #63 and #64 rather than assuming their patches apply cleanly to the current branch.
- Identify focused regressions for active MIME families, ordinary inline media, range/HEAD/conditional responses, and query-free paired log lines.

## Deferred Ideas

- `robots.txt` crawler support remains captured separately as `SEED-001`; it is not part of Phase 3.
- The Phase 2 filter-safe test-harness and storage/metadata consistency warnings remain outside this phase.
