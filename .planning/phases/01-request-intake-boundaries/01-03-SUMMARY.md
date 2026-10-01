---
phase: 01-request-intake-boundaries
plan: 03
subsystem: request-routing
tags: [deno, hono, bud-01, static-files, path-validation, unicode]

requires:
  - phase: 01-request-intake-boundaries
    provides: PR #54 revised-integration contract, locked Unicode code-point metric, and contribution traceability rules
provides:
  - Exact normalized blob filename grammar with bounded cosmetic extension segments
  - Pre-filesystem static candidacy screening with observable middleware injection
  - Unicode code-point boundary coverage for 255/256 segment and 2,048/2,049 path limits
  - One attributed PR #54 integration commit with changelog and full-SHA review linkage
affects: [authorization-compatibility, content-and-logging-boundaries, release-traceability]

actuals:
  tokens: 5234
  tasks: 3
  commits: 2
plan_head_before: ce0acfd41d44b7abd63163a2bbe6c6feb8a4414d

tech-stack:
  added: []
  patterns:
    - Pure request-path predicates before database, storage, or filesystem access
    - Injectable Hono middleware seam for non-vacuous I/O-boundary assertions

key-files:
  created:
    - tests/unit/blob-path.test.ts
    - .planning/WINDOWS.md
  modified:
    - src/routes/blobs.ts
    - src/utils/url.ts
    - src/server.ts
    - tests/unit/url.test.ts
    - tests/e2e/blobs.test.ts
    - CHANGELOG.md
    - .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md
    - .planning/phases/01-request-intake-boundaries/deferred-items.md

key-decisions:
  - "D-11 counts both decoded segment and whole-path limits as Unicode code points using [...text].length."
  - "Blob extensions remain cosmetic; stored blob MIME determines both storage extension and response Content-Type."
  - "Temporary RED/GREEN commits were consolidated into the single D-16 PR #54 integration commit."

patterns-established:
  - "Blob intake: accept only an anchored 64-hex hash plus bounded ASCII-alphanumeric extension segments, then normalize the hash before lookup."
  - "Static intake: reject encoded separators before one guarded decode, then validate decoded structure and code-point limits before invoking serveStatic."

requirements-completed: [INTK-03, INTK-07]

coverage:
  - id: D1
    description: "Blob GET/HEAD accepts only the exact normalized D-06–D-08 grammar while keeping requested suffixes cosmetic."
    requirement: INTK-03
    verification:
      - kind: unit
        ref: "tests/unit/blob-path.test.ts#extractBlobHash accepted/rejected matrix"
        status: pass
      - kind: e2e
        ref: "tests/e2e/blobs.test.ts#accepted hash variants, malformed paths, and stored MIME"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unsafe decoded or encoded static paths bypass filesystem middleware while safe nested, space, and Unicode paths remain eligible."
    requirement: INTK-03
    verification:
      - kind: unit
        ref: "tests/unit/url.test.ts#isStaticCandidate matrix"
        status: pass
      - kind: e2e
        ref: "tests/e2e/blobs.test.ts#static middleware invocation counters"
        status: pass
    human_judgment: false
  - id: D3
    description: "PR #54 is represented by one contributor-credited integration commit on v6.4.1 with a full-SHA review link."
    requirement: INTK-07
    verification:
      - kind: other
        ref: "branch ancestry, exact Contribution-PR trailer counts, changelog, and review assertions"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-10-01
status: complete
---

# Phase 1 Plan 3: Blob and Static Path Boundaries Summary

**Exact blob filename parsing and Unicode-aware static admission prevent malformed paths from reaching storage or filesystem work while preserving compatible
retrieval**

## Performance

- **Duration:** 12 min
- **Started:** 2026-10-01T14:21:23Z
- **Completed:** 2026-10-01T14:33:15Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Replaced substring hash extraction with an anchored, case-normalizing parser that accepts bounded multi-extension suffixes and one trailing slash.
- Added a pre-filesystem static predicate that rejects malformed encoding, repeated encoded separators, controls, backslashes, unsafe segments, and exact
  Unicode code-point overflow boundaries while retaining safe nested, space, BMP, and non-BMP paths.
- Added a non-vacuous injected middleware seam proving unsafe paths never invoke static handling and safe controls do.
- Landed revised PR #54 as one non-merge integration commit credited to @mptfire, with a credited Unreleased patch note and full-SHA review linkage.

## Task Commits

The plan's D-16 traceability contract requires Tasks 1 and 2 to form one integration commit:

1. **Tasks 1-2: Prove and expand exact blob/static intake boundaries** - `0f6b99a` (fix; `Contribution-PR: #54`)
2. **Task 3: Backfill PR #54 identity and integrated evidence** - `348213b` (docs)

## Files Created/Modified

- `src/routes/blobs.ts` - Anchored `extractBlobHash` parser and shared GET/HEAD handler for ordinary and trailing-slash paths.
- `src/utils/url.ts` - Encoded/decoded static candidacy predicate with locked Unicode code-point limits.
- `src/server.ts` - Candidate-gated default static middleware plus an injectable observation seam.
- `tests/unit/blob-path.test.ts` - D-06–D-08 accepted and rejected filename grammar matrix.
- `tests/unit/url.test.ts` - D-10–D-12 candidacy matrix including non-BMP, combining-sequence, and exact limit cases.
- `tests/e2e/blobs.test.ts` - Observable static invocation, 404 fallthrough, valid retrieval, trailing slash, and stored-MIME regressions.
- `CHANGELOG.md` - Credited Unreleased patch entry for @mptfire and PR #54.
- `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` - Focused and integrated evidence plus the full integration SHA.
- `.planning/phases/01-request-intake-boundaries/deferred-items.md` - Out-of-scope shared/untracked formatting drift observed by the repository-wide check.
- `.planning/WINDOWS.md` - Cross-phase deviation record, marked fixed after verification.

## Decisions Made

- Count both D-11 limits with `[...text].length`, making a non-BMP scalar one code point and a combining sequence multiple code points.
- Inspect direct and repeatedly percent-encoded separators before one guarded `decodeURIComponent`, then apply decoded structural validation.
- Keep requested suffixes entirely outside MIME and storage-extension selection; `blob.type` remains authoritative.

## TDD Gate Compliance

- RED: `extractBlobHash accepts a whole lowercase hash` failed intentionally because the export was absent; GSD returned `RED_EVIDENCE_OK`.
- GREEN: the parser, static predicate, injected middleware seam, and tracer passed 23 focused tests.
- Expansion: the complete boundary matrix passed immediately because the tracer installed the full production skeleton, then passed 82 focused tests.
- D-16 consolidation: temporary RED `7a47bc4` and GREEN `b567f71` commits were squashed into integration commit `0f6b99a`, as explicitly required by the plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced a lint-invalid control-character regular expression**

- **Found during:** Task 1 (GREEN verification)
- **Issue:** Deno's `no-control-regex` rule rejected the initial explicit C0/C1 range expression.
- **Fix:** Replaced it with an explicit code-point predicate that preserves the exact control, DEL, C1, and backslash rejection behavior.
- **Files modified:** `src/utils/url.ts`
- **Verification:** Focused tests, targeted formatting, `deno lint`, integrated Phase 1 tests, and the full suite passed.
- **Committed in:** `0f6b99a` (part of the consolidated integration commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug). **Impact on plan:** The fix preserves the locked behavior and introduces no scope change.

## Issues Encountered

- Sandboxed E2E runs could not access system information required by LibSQL's native loader. The same commands passed with approved host permissions.
- Repository-wide `deno fmt --check` reports pre-existing formatting drift in orchestrator/research artifacts outside this plan, including shared STATE/ROADMAP
  files that this executor was explicitly instructed not to modify. All Plan 01-03 files pass targeted formatting; the existing drift remains recorded in
  `deferred-items.md`.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Verification

- Focused PR #54 suite: 82 passed, 0 failed.
- Integrated Phase 1 suite: 145 passed, 0 failed.
- Full server suite: 349 passed, 0 failed.
- Client suite: 2 passed, 0 failed.
- Lint: 81 files checked successfully.
- Targeted formatting passed for every Plan 01-03 source, test, changelog, review, deferred-item, and summary file.
- Branch/ancestry and unique `Contribution-PR: #53` / `Contribution-PR: #54` trailer assertions passed.

## Next Phase Readiness

- Phase 1 request-intake boundaries are complete: PRs #53 and #54 are each represented by one attributed integration commit with focused regression evidence.
- Phase 2 can add BUD-11 hash scoping and strict expiration parsing on top of the normalized blob route without inheriting malformed path ambiguity.
- No Plan 01-03 implementation blockers remain; only the pre-existing shared/untracked planning-format drift remains outside this plan's ownership.

## Self-Check: PASSED

- Confirmed every production, test, changelog, review, summary, and ledger artifact exists on disk.
- Confirmed integration commit `0f6b99a` and evidence-backfill commit `348213b` exist in repository history.
- Re-ran focused tests, integrated tests, the full server/client suite, lint, targeted formatting, branch/ancestry, trailer-count, review-content, and
  coverage-schema checks successfully.
- Found no implementation stubs, skipped tests, accidental deletions, open broken-window entries, or threat surface beyond the plan's registered request-path
  boundaries.

---

_Phase: 01-request-intake-boundaries_\
_Completed: 2026-10-01_
