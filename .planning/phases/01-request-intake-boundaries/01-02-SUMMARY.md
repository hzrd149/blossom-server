---
phase: 01-request-intake-boundaries
plan: 02
subsystem: request-admission
tags: [deno, hono, streaming, mime, bud-02, bud-05]

requires:
  - phase: 01-request-intake-boundaries
    provides: PR #53 revised-integration contract, contributor attribution, and release-branch traceability rules
provides:
  - Pre-auth envelope admission for PUT/HEAD upload and media surfaces
  - Side-effect-free multipart and URL-encoded base-MIME classification
  - Cancellation and no-pull regression evidence for rejected streaming PUT bodies
  - One attributed PR #53 integration commit with changelog and review linkage
affects: [01-03, authorization-compatibility, release-traceability]

actuals:
  tokens: 3645
  tasks: 3
  commits: 2
plan_head_before: b5099a92d884e3d9de8bec78eb82d76bb64dca48

tech-stack:
  added: []
  patterns:
    - Exact-surface Hono admission middleware before authentication
    - Streaming rejection by cancellation without body reads

key-files:
  created:
    - src/middleware/envelope.ts
    - tests/unit/envelope.test.ts
  modified:
    - src/utils/mime.ts
    - src/server.ts
    - tests/e2e/upload.test.ts
    - tests/e2e/media.test.ts
    - CHANGELOG.md
    - .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md

key-decisions:
  - "Envelope admission is global in ordering but restricted to the four exact D-01 method/path pairs."
  - "HEAD /upload reads only X-Content-Type, while HEAD /media preserves X-Content-Type then Content-Type precedence."
  - "Temporary RED/GREEN commits were consolidated into the single D-16 PR #53 integration commit."

patterns-established:
  - "Pre-auth admission: reject invalid representation metadata before BUD-11 parsing, but call next() for every accepted request."
  - "Body ownership: rejected PUT streams are cancelled exactly once and never pulled."

requirements-completed: [INTK-02, INTK-07]

coverage:
  - id: D1
    description: "Envelope MIME classification handles case, parameters, multipart subtypes, URL encoding, absent values, and ordinary raw/image controls."
    requirement: INTK-02
    verification:
      - kind: unit
        ref: "tests/unit/envelope.test.ts#isEnvelopeMime table (10 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "PUT/HEAD upload and media reject encoded envelopes before auth, cancel rejected PUT bodies without pulls, and preserve raw requests."
    requirement: INTK-02
    verification:
      - kind: e2e
        ref: "deno test -A tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts (63 passed)"
        status: pass
      - kind: integration
        ref: "deno task test (297 server tests and 2 client tests passed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "PR #53 is represented by one contributor-credited integration commit on v6.4.1 with a full-SHA review link."
    requirement: INTK-07
    verification:
      - kind: other
        ref: "git trailer count, branch, ancestry, changelog, and contribution-review assertions"
        status: pass
    human_judgment: false

duration: 23min
completed: 2026-10-01
status: complete
---

# Phase 1 Plan 2: Pre-Auth Envelope Admission Summary

**Exact-surface upload/media admission rejects multipart and URL-encoded wrappers before auth while cancelling hostile PUT streams without reading them**

## Performance

- **Duration:** 23 min
- **Started:** 2026-10-01T13:55:01Z
- **Completed:** 2026-10-01T14:18:26Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added a normalized base-MIME classifier and exact PUT/HEAD `/upload` and `/media` admission middleware between CORS and BUD-11 auth parsing.
- Proved all four surfaces reject multipart and URL-encoded envelopes with ASCII `X-Reason`, while PUT streams cancel exactly once without any pull.
- Preserved raw, absent, and ordinary image MIME behavior through the existing explicit auth, rule, worker, and storage pipelines.
- Landed revised PR #53 as one non-merge integration commit credited to @mptfire, with a full-SHA contribution-review backfill and Unreleased patch note.

## Task Commits

The plan's D-16 traceability contract requires Tasks 1 and 2 to form one integration commit:

1. **Tasks 1-2: Prove and expand pre-auth envelope admission** - `3c1045f` (fix; `Contribution-PR: #53`)
2. **Task 3: Backfill PR #53 commit identity and executed evidence** - `bcf1c39` (docs)

## Files Created/Modified

- `src/middleware/envelope.ts` - Exact-surface pre-auth admission with PUT cancellation and fixed ASCII 415 guidance.
- `src/utils/mime.ts` - Pure base-MIME envelope classifier.
- `src/server.ts` - CORS → envelope admission → auth parser middleware ordering.
- `tests/unit/envelope.test.ts` - Ten-case classifier matrix.
- `tests/e2e/upload.test.ts` - Upload precedence, cancellation/no-pull, header-source, and raw compatibility coverage.
- `tests/e2e/media.test.ts` - Media PUT/HEAD envelope, cancellation/no-pull, and header-precedence coverage.
- `CHANGELOG.md` - Credited Unreleased patch entry for @mptfire and PR #53.
- `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` - Focused 63-test result and full integration SHA.

## Decisions Made

- Use one shared middleware rather than duplicating envelope checks in route handlers, ensuring malformed authentication cannot preempt the representation
  error.
- Normalize only the trimmed base token before the first semicolon; reject every `multipart/*` subtype and exact URL-encoded base type without a new dependency.
- Retain the route-specific HEAD contracts: upload uses `X-Content-Type`; media uses `X-Content-Type` with `Content-Type` fallback.

## TDD Gate Compliance

- RED: `isEnvelopeMime: multipart form data` failed on an intentional assertion (`undefined` instead of `true`); GSD returned `RED_EVIDENCE_OK`.
- GREEN: the classifier, middleware, ordering, cancellation tracer, and raw-body control passed 39 focused tests.
- Expansion: the remaining matrix passed immediately because the tracer intentionally installed the complete four-surface production skeleton.
- D-16 consolidation: temporary RED `2da901a` and GREEN `9b986ff` commits were squashed into integration commit `3c1045f` as explicitly required by the plan.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first sandboxed E2E RED run could not access system information required by LibSQL's native loader. The unit RED assertion was captured separately and
  validated as `RED_EVIDENCE_OK`; subsequent worker-backed runs used the approved host permissions and passed.
- Repository-wide `deno fmt --check` reports pre-existing formatting drift in shared planning artifacts outside this plan's ownership. All eight plan-touched
  files pass targeted formatting, `deno lint` passes 80 files, and the committed production/test tree passes every behavioral test. The untouched formatting
  debt is recorded in `deferred-items.md`.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Verification

- Focused envelope suite: 63 passed, 0 failed.
- Full server suite: 297 passed, 0 failed.
- Client suite: 2 passed, 0 failed.
- Lint: 80 files checked successfully.
- Branch/ancestry and unique `Contribution-PR: #53` trailer assertions passed.
- Targeted formatting passed for every Plan 01-02 source, test, changelog, review, and summary file; the unrelated repository-wide planning drift remains
  deferred as noted above.

## Next Phase Readiness

- Plan 01-03 can add blob/static path admission after the envelope gate without changing route order or accepted-request auth behavior.
- PR #53 traceability is complete from contributor and changelog through integration SHA and executed regression evidence.
- No Plan 01-02 implementation blockers remain.

## Self-Check: PASSED

- Confirmed the new middleware, unit suite, and summary exist on disk.
- Confirmed integration commit `3c1045f` and evidence-backfill commit `bcf1c39` exist in repository history.
- Re-ran focused tests, the full server/client suite, lint, targeted formatting, branch/ancestry, trailer-count, and coverage-schema checks successfully.
- Found no implementation stubs, skipped tests, unrun behavioral verification, accidental deletions, or threat surface beyond the plan's registered HTTP
  boundary.

---

_Phase: 01-request-intake-boundaries_\
_Completed: 2026-10-01_
