---
phase: 02-authorization-compatibility
plan: 01
subsystem: auth
tags: [bud-11, nostr, hono, deno, authorization, streaming]

requires:
  - phase: 01-request-intake-boundaries
    provides: Reviewed contribution-integration contract and safe streaming rejection patterns
provides:
  - Strict complete-decimal safe-integer validation for BUD-11 expiration tags
  - Exact required blob-hash scope enforcement for protected upload, preflight, and delete operations
  - Traceable adapted integration of PR #62 without an undocumented lifetime cap
affects: [03-content-and-logging-boundaries, 04-integrated-candidate-verification, 05-v6.4.1-release]

actuals:
  tokens: 5664
  tasks: 3
  commits: 2
plan_head_before: bb649f31139bdf4c1094e02936e26e7e435a6803

tech-stack:
  added: []
  patterns:
    - Validate numeric protocol tags with complete-string grammar before conversion and safe-integer checks
    - Enforce known blob scope before dispatch and computed blob scope before storage commit

key-files:
  created: []
  modified:
    - src/middleware/auth.ts
    - src/routes/upload.ts
    - tests/unit/auth.test.ts
    - tests/e2e/upload.test.ts
    - tests/e2e/delete.test.ts
    - tests/e2e/list.test.ts
    - CHANGELOG.md
    - .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md

key-decisions:
  - "BUD-11 expiration accepts every future complete base-10 decimal safe integer; no fixed maximum lifetime is imposed."
  - "When a blob hash is known, required scope is satisfied only by an exact matching x tag; missing and mismatched scope both return 403."
  - "PR #62 is adapted into one attributable non-merge contribution commit rather than cherry-picked because its proposed 30-day cap is incompatible."

patterns-established:
  - "Streaming authorization boundary: cancel early rejected request bodies and abort deferred staged writes before metadata or storage commit."
  - "Contribution traceability: one non-merge integration commit, credited changelog entry, focused regression evidence, and immutable SHA backfill."

requirements-completed: [INTK-04]

coverage:
  - id: D1
    description: BUD-11 expiration accepts only complete decimal safe integers, rejects expired events, and retains long-future compatibility.
    requirement: INTK-04
    verification:
      - kind: unit
        ref: tests/unit/auth.test.ts#parseAuthEvent expiration and encoding compatibility matrix
        status: pass
    human_judgment: false
  - id: D2
    description: Protected PUT and HEAD upload plus DELETE require an exact blob-hash x tag and preserve safe stream cleanup.
    requirement: INTK-04
    verification:
      - kind: e2e
        ref: tests/e2e/upload.test.ts#scope and cleanup matrix
        status: pass
      - kind: e2e
        ref: tests/e2e/delete.test.ts#scope and non-deletion matrix
        status: pass
    human_judgment: false
  - id: D3
    description: PR #62 is integrated with contributor credit, without its lifetime cap, and linked to exactly one non-merge contribution commit.
    requirement: INTK-04
    verification:
      - kind: other
        ref: git contribution-trailer and review-evidence acceptance gate
        status: pass
    human_judgment: false

duration: 36min
completed: 2026-10-01
status: complete
---

# Phase 02 Plan 01: Authorization Compatibility Summary

**Strict BUD-11 expiration and exact blob-scope authorization with safe streaming cleanup and a traceable PR #62 adaptation**

## Performance

- **Duration:** 36 min
- **Started:** 2026-10-01T17:03:42Z
- **Completed:** 2026-10-01T17:39:10Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Replaced permissive expiration parsing with complete decimal grammar, safe-integer validation, expired-event rejection, and unrestricted safe future values.
- Required exact matching blob-hash `x` scope across protected PUT/HEAD upload and DELETE while preserving headerless HEAD preflight compatibility.
- Proved early body cancellation, deferred staged-write abort, non-deletion on denial, standard/Base64url compatibility, and the full repository test gate.
- Adapted PR #62 into one credited non-merge contribution commit and backfilled its immutable SHA into the contribution review.

## Task Commits

1. **Task 1: Prove strict expiration and required blob scope through protected PUT /upload** - `3f68b6a` (fix; consolidated TDD contribution commit)
2. **Task 2: Expand preflight/delete regressions and form the single PR #62 integration commit** - `3f68b6a` (fix; shared by design to satisfy the one-commit
   contribution contract)
3. **Task 3: Backfill PR #62 identity and run the complete Phase 2 Deno gate** - `7efc2ee` (docs)

Tasks 1 and 2 intentionally resolve to the same final commit because the plan required exactly one non-merge PR #62 integration commit carrying
`Contribution-PR: #62`.

## Files Created/Modified

- `src/middleware/auth.ts` - Validates complete safe-integer expiration tags and enforces exact required `x` scope.
- `src/routes/upload.ts` - Enforces declared-hash HEAD/PUT scope while preserving optional preflight headers and stream cleanup.
- `tests/unit/auth.test.ts` - Covers expiration grammar, safe range, long-future acceptance, required scope, and encoding compatibility.
- `tests/e2e/upload.test.ts` - Covers PUT/HEAD scope outcomes plus early cancellation and deferred staging cleanup.
- `tests/e2e/delete.test.ts` - Covers missing/mismatched denial, retained blobs, and successful scoped deletion.
- `tests/e2e/list.test.ts` - Uses a correctly hash-scoped authorization event for authenticated seed uploads.
- `CHANGELOG.md` - Credits @mptfire and PR #62 under Unreleased Patch Changes.
- `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` - Records adaptation rationale, verification, and final integration SHA.

## Decisions Made

- No fixed authorization lifetime cap was introduced. A safe future expiration remains compatible regardless of distance.
- Missing and mismatched required blob scope deliberately share the same `403` response.
- A valid `X-SHA-256` on authenticated HEAD `/upload` supplies enforceable scope, while omitting the optional header retains the existing preflight response.

## TDD Gate Compliance

- **RED:** The focused Task 1 run produced 63 passing and 4 intentionally failing tests for permissive expiration parsing and optional required scope.
- **RED evidence:** `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` against the persisted TAP evidence before implementation.
- **GREEN:** The tracer slice passed 67 focused tests after production changes, then passed the required end-to-end tracer feedback gate.
- **Expansion:** The complete authorization matrix passed 88 focused tests before the final integration commit.
- **Commit contract:** Temporary RED (`11e9640`) and GREEN (`472ffd7`) commits were consolidated into `3f68b6a` so PR #62 has exactly one attributable non-merge
  integration commit, as required by the plan.

## Verification

- `deno test -A tests/unit/auth.test.ts tests/e2e/upload.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts` - 88 passed, 0 failed.
- `deno fmt --check` over tracked files - passed.
- `deno lint` - passed.
- `deno task test` - 367 server tests and 2 client tests passed.
- Contribution gate - exactly one non-merge commit carries `Contribution-PR: #62`; review SHA and changelog credit are present.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Scoped the list-test seed upload during tracer completion**

- **Found during:** Task 1 (tracer verification)
- **Issue:** Tightening `requireXTag()` made an existing authenticated seed-upload helper in `tests/e2e/list.test.ts` fail before the planned expansion task.
- **Fix:** Moved the already-planned hash-scoped seed fixture adjustment forward so the tracer feedback gate exercised the corrected authorization contract.
- **Files modified:** `tests/e2e/list.test.ts`
- **Verification:** The tracer gate passed 67 tests, and the expanded focused gate passed 88 tests.
- **Committed in:** `3f68b6a`

---

**Total deviations:** 1 auto-fixed (1 Rule 3) **Impact on plan:** Only task sequencing changed; scope and final artifacts remained exactly as planned.

## Issues Encountered

- Deno's formatter does not select hidden `.planning` Markdown files as a sole path target. The review was formatted through stdin and compared byte-for-byte
  before commit; the full tracked-file format gate also passed.
- Native LibSQL test access required running the focused/full Deno gates with the repository's approved permissions. No product behavior changed.

## Known Stubs

None. The stub scan found only test-local empty defaults/arrays used by fixtures and assertions; no production or UI data path is stubbed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 can build content-delivery and logging boundaries on the now-strict authorization contract.
- Phase 4 has focused and full-suite authorization evidence plus immutable contribution traceability to re-run in the integrated candidate.
- No blockers remain for the next phase.

## Self-Check: PASSED

- All eight planned implementation/evidence files exist in the realized diff.
- Integration commit `3f68b6a` and evidence-backfill commit `7efc2ee` exist in repository history.
- The persisted plan ledger resolves to the recorded base and two pre-metadata plan commits.

---

_Phase: 02-authorization-compatibility_ _Completed: 2026-10-01_
