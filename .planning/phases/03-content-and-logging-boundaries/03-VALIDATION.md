---
phase: 03-content-and-logging-boundaries
status: draft
nyquist: true
requirements: [INTK-05, INTK-06]
---

# Phase 3 Validation Strategy

## Test Commands

- Quick: `deno test -P --env-file=.env tests/unit/mime.test.ts tests/unit/logger.test.ts tests/e2e/active-content.test.ts`
- Retrieval regression: `deno test -P --env-file=.env tests/e2e/blobs.test.ts tests/unit/range.test.ts`
- Full gate: `deno task test`
- Static gates: `deno fmt --check` and `deno lint`

## Requirement Map

| Requirement | Automated evidence | Location |
| --- | --- | --- |
| INTK-05 | MIME normalization and active-type classifier matrix | `tests/unit/mime.test.ts` |
| INTK-05 | Active and ordinary response policy across GET, HEAD, `206`, and `304`; safe hash-derived filename; cosmetic suffix ignored | `tests/e2e/active-content.test.ts` |
| INTK-05 | Existing path, range, and retrieval behavior | `tests/e2e/blobs.test.ts`, `tests/unit/range.test.ts` |
| INTK-06 | Both logger lines omit queries while preserving encoded pathname and operational context | `tests/unit/logger.test.ts` |

## Required Cases

### Active content

- True: normalized HTML/XML bases, SVG, XHTML, XSLT, and an arbitrary `+xml` subtype.
- False: absent/empty MIME, ordinary media, JSON, plain text, and XML lookalikes.
- Active GET, HEAD, range `206`, and conditional `304` carry attachment disposition and `nosniff`.
- Ordinary representations remain inline across the same response paths while carrying `nosniff`.
- Attachment names use the full hash plus a safe stored-MIME extension or the bare hash fallback.
- Requested cosmetic suffixes do not affect policy or filename.

### Logging

- Request and response lines preserve the serialized percent-encoded pathname.
- Query parameter names and values appear in neither line.
- Method, status, timing, and `X-Reason` remain observable.

## Execution Policy

- Create the three missing focused test files during Wave 0/TDD work.
- Run the relevant focused tests at each PR integration commit.
- Run retrieval regressions after PR #63 adaptation.
- Run formatting, lint, and the full suite before phase verification.
- Tests that need app state must be self-contained and clean up with `finally`; do not add filter-dependent fixture tests.
