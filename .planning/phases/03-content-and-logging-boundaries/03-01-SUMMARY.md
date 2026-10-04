---
phase: 03-content-and-logging-boundaries
plan: 01
subsystem: api
tags: [deno, hono, http-headers, mime, active-content, bud-01]

requires:
  - phase: 01-request-intake-boundaries
    provides: Exact content-addressed blob-path parsing with cosmetic suffixes
  - phase: 02-authorization-compatibility
    provides: Stable v6.4.1 release-candidate contribution workflow
provides:
  - Normalized active-content MIME classification for HTML and XML-derived media types
  - Active-only attachment delivery and nosniff headers across GET, HEAD, range, and conditional responses
  - Traceable PR #63 integration with focused regression evidence and contributor credit
affects: [03-02-query-free-logging, 04-integrated-candidate-verification, 05-v6.4.1-release]

actuals:
  tokens: 4259
  tasks: 2
  commits: 1
plan_head_before: a17aecee0f333b1ae5b34f091a4fe3bba87e2c9d

tech-stack:
  added: []
  patterns:
    - Stored MIME metadata controls response security policy; request suffixes remain cosmetic
    - Shared successful-response headers are explicitly projected into bodyless 304 responses

key-files:
  created:
    - tests/unit/mime.test.ts
    - tests/e2e/active-content.test.ts
  modified:
    - src/utils/mime.ts
    - src/routes/blobs.ts
    - CHANGELOG.md
    - .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md

key-decisions:
  - "Classify only normalized text/html, text/xml, application/xml, and syntactically present +xml subtypes as active content."
  - "Derive attachment names from the full normalized content hash and a revalidated stored-MIME extension, never the request suffix."
  - "Project security headers into 304 explicitly so representation-only Content-Length remains absent."

patterns-established:
  - "Response policy boundary: persisted MIME determines attachment and filename behavior."
  - "Conditional response projection: copy validators, cache metadata, nosniff, and optional disposition without spreading representation headers."

requirements-completed: [INTK-05]

coverage:
  - id: D1
    description: Normalized active-content classifier covers HTML, exact XML bases, arbitrary +xml types, and malformed controls.
    requirement: INTK-05
    verification:
      - kind: unit
        ref: tests/unit/mime.test.ts#isActiveContentMime truth table
        status: pass
    human_judgment: false
  - id: D2
    description: Active blobs download with full-hash safe names and nosniff across GET 200, HEAD 200, range 206, and conditional 304.
    requirement: INTK-05
    verification:
      - kind: e2e
        ref: tests/e2e/active-content.test.ts#blob responses isolate active content without changing ordinary retrieval
        status: pass
    human_judgment: false
  - id: D3
    description: Ordinary blobs remain inline with existing body, range, validator, and cache behavior while receiving nosniff.
    requirement: INTK-05
    verification:
      - kind: e2e
        ref: deno test -P --env-file=.env tests/e2e/blobs.test.ts tests/unit/range.test.ts
        status: pass
    human_judgment: false
  - id: D4
    description: PR #63 is represented exactly once by a non-merge contribution commit with contributor credit and adaptation evidence.
    requirement: INTK-05
    verification:
      - kind: other
        ref: git rev-list --no-merges --count --extended-regexp --grep='^Contribution-PR: #63$' master..HEAD
            status: pass
    human_judgment: false

duration: 11h 11m
completed: 2026-10-04
status: complete
---

# Phase 3 Plan 1: Active Content Isolation Summary

**Stored HTML and XML-derived blobs now download with full-hash safe filenames, while all successful blob responses receive nosniff without changing ordinary streaming or range behavior.**

## Performance

- **Duration:** 11h 11m
- **Started:** 2026-10-03T14:50:48Z
- **Completed:** 2026-10-04T02:02:44Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added a normalized active-content MIME classifier covering exact HTML/XML bases and every syntactically present `+xml` subtype.
- Applied `nosniff` to all successful blob response branches and active-only attachment disposition to GET, HEAD, range `206`, and conditional `304`.
- Preserved ordinary inline retrieval, streaming, range, validator, cache, and bodyless `304` behavior with a 19-test focused matrix and 60 passing compatibility regressions.
- Integrated PR #63 as exactly one non-merge commit with @mptfire credit, adaptation rationale, changelog coverage, and the required contribution trailer.

## Task Commits

The contribution contract requires the tracer implementation and attribution documentation to land together as one immutable integration commit:

1. **Tasks 1-2: Prove and integrate active-content isolation** - `a114fce` (`feat`)

## Files Created/Modified

- `src/utils/mime.ts` - Exports the normalized active-content MIME classifier.
- `src/routes/blobs.ts` - Applies successful-response security headers and safe active-content filenames.
- `tests/unit/mime.test.ts` - Covers exact, normalized, arbitrary `+xml`, ordinary, and malformed MIME cases.
- `tests/e2e/active-content.test.ts` - Exercises active and ordinary GET, HEAD, `206`, and `304` responses through the real app and local storage.
- `CHANGELOG.md` - Credits @mptfire and PR #63 under Unreleased Patch Changes.
- `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` - Records the adapted disposition, deviations, executed evidence, and pending SHA backfill.

## Decisions Made

- Stored MIME metadata is the sole response-policy authority; requested filename suffixes do not affect classification or attachment naming.
- Attachment extensions are accepted only when `mimeToExt()` returns 1-10 ASCII alphanumeric characters; otherwise the full hash is used alone.
- Conditional `304` responses receive an explicit security/cache projection rather than the full representation header object.

## TDD Evidence

- **RED:** `isActiveContentMime: HTML` failed on the expected `undefined` versus `true` assertion, and the persisted evidence passed `gsd_run check tdd-red-evidence` with `RED_EVIDENCE_OK`.
- **GREEN:** The focused classifier/route suite passed 19 tests; the existing blob/range suite passed 60 tests; targeted formatting and lint checks passed.
- **Integration:** Temporary RED/GREEN commits were consolidated into `a114fce` because the locked contribution contract requires all PR #63 code, tests, credit, and review evidence in exactly one non-merge commit.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first RED run stopped at Deno 2 generic-buffer type checking in the new fixture. The fixture was corrected before production code changed, after which the target classifier and response-header assertions produced the intentional RED result.
- LibSQL system-interface inspection was blocked by the restricted shell sandbox, so the planned Deno E2E commands were rerun with repository-approved execution permissions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PR #63 is ready for Plan 03-02 to integrate PR #64 and backfill both immutable contribution SHAs.
- No implementation or verification blockers remain.

## Self-Check: PASSED

- All six declared implementation, test, changelog, and review files exist.
- Commit `a114fce` exists, changes exactly those six files, and is the sole non-merge `Contribution-PR: #63` commit on `master..HEAD`.
- All four coverage entries passed deterministic coverage classification.

---

_Phase: 03-content-and-logging-boundaries_
_Completed: 2026-10-04_
