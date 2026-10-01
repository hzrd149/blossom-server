---
phase: 01-request-intake-boundaries
plan: 04
subsystem: request-routing
tags: [deno, hono, serve-static, utf8, path-security, tdd]

# Dependency graph
requires:
  - phase: 01-request-intake-boundaries/01-03
    provides: Anchored blob parsing, decoded static-path screening, and injected static-dispatch observation
provides:
  - UTF-8 byte limits aligned with Hono's decodeURI filesystem representation
  - Real serveStatic adapter regressions for segment and whole-path boundaries
  - Request-layer canonicalization contract with public-root equivalence proof
affects: [authorization-compatibility, integrated-candidate-verification, release-validation]

actuals:
  tokens: 4291
  tasks: 2
  commits: 3
plan_head_before: f1d920846ba889518d3fcc003230144a93af737a

tech-stack:
  added: []
  patterns:
    - Validate both fully decoded policy text and the decodeURI representation before static dispatch
    - Observe real serveStatic callbacks and warnings instead of inferring filesystem access from HTTP status

key-files:
  created:
    - .planning/phases/01-request-intake-boundaries/01-04-SUMMARY.md
  modified:
    - src/utils/url.ts
    - tests/unit/url.test.ts
    - tests/e2e/blobs.test.ts
    - CHANGELOG.md
    - .planning/phases/01-request-intake-boundaries/01-CONTEXT.md
    - .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md

key-decisions:
  - "Retain D-11's Unicode code-point limits and add 255-byte segment plus 2,048-byte whole-path limits to the valid decodeURI representation."
  - "Define D-12 at the observable Request layer: accept URL-standard dot-segment canonicalization, then validate the normalized pathname and confine serving to PUBLIC_DIR."

patterns-established:
  - "Two-representation static admission: decodeURIComponent supplies policy text while decodeURI supplies the filesystem-facing byte representation."
  - "Adapter-boundary proof: pair an injected invocation counter with real Hono/Deno onNotFound and warning observation."

requirements-completed: [INTK-01, INTK-02, INTK-03, INTK-07]

coverage:
  - id: D1
    description: Static candidates enforce code-point and UTF-8 byte caps before Hono/Deno filesystem access.
    requirement: INTK-03
    verification:
      - kind: unit
        ref: tests/unit/url.test.ts#static byte-boundary fixtures isolate the decodeURI filesystem limits
        status: pass
      - kind: e2e
        ref: tests/e2e/blobs.test.ts#real static adapter observes exact byte controls and bypasses overflows without warnings
        status: pass
    human_judgment: false
  - id: D2
    description: Request dot-segment canonicalization serves only the tracked canonical asset under PUBLIC_DIR.
    requirement: INTK-03
    verification:
      - kind: unit
        ref: tests/unit/url.test.ts#Request canonicalizes encoded dot segments before application pathname validation
        status: pass
      - kind: e2e
        ref: tests/e2e/blobs.test.ts#production Request canonicalization serves the tracked public favicon from inside PUBLIC_DIR
        status: pass
    human_judgment: false
  - id: D3
    description: Prior envelope, blob grammar, attribution, release-branch, and integration-trailer guarantees remain intact.
    requirement: INTK-07
    verification:
      - kind: integration
        ref: deno test -A tests/unit/url.test.ts tests/unit/blob-path.test.ts tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts
        status: pass
      - kind: other
        ref: v6.4.1 ancestry and unique Contribution-PR #53/#54 trailer assertions
        status: pass
    human_judgment: false

duration: 12m
completed: 2026-10-01
status: complete
---

# Phase 01 Plan 04: Static Intake Gap Closure Summary

**UTF-8-aware static admission now stops filesystem representation overflows before Hono/Deno access while preserving exact-boundary assets and honest Request
canonicalization semantics.**

## Performance

- **Duration:** 12 minutes
- **Started:** 2026-10-01T15:42:30Z
- **Completed:** 2026-10-01T15:54:46Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Preserved D-11's decoded Unicode code-point caps and added 255-byte segment plus 2,048-byte whole-path limits to the `decodeURI` representation used by Hono
  static serving.
- Proved exact and overflowing multibyte, retained-reserved, and whole-path cases through both the injected dispatch seam and Hono's real Deno `serveStatic`
  adapter without filesystem warnings.
- Revised D-12 around the pathname the Web `Request` API actually exposes and verified canonical equivalence against the tracked `public/favicon.ico` under
  `PUBLIC_DIR`.
- Retained the credited PR #54 changelog entry, original integration SHA, branch ancestry, and exactly one contribution trailer for each accepted PR.

## Task Commits

Each task was committed atomically; Task 1 used separate RED and GREEN commits:

1. **Task 1 RED: Add failing static byte-boundary tracer** - `8a4f310` (test)
2. **Task 1 GREEN: Bound static filesystem path bytes** - `1999ea9` (feat)
3. **Task 2: Close static adapter boundary gaps and revise D-12** - `2ec6741` (test)

## Files Created/Modified

- `src/utils/url.ts` - Screens decoded policy text and the filesystem-facing representation against independent code-point and byte caps.
- `tests/unit/url.test.ts` - Covers exact/overflow segment and whole-path byte boundaries plus observable Request canonicalization.
- `tests/e2e/blobs.test.ts` - Exercises injected and real static adapters, warning absence, and tracked favicon equivalence.
- `CHANGELOG.md` - Describes conservative filesystem byte bounds while preserving @mptfire and PR #54 attribution.
- `.planning/phases/01-request-intake-boundaries/01-CONTEXT.md` - Revises D-11/D-12 to the verified representation and Request-layer contracts.
- `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` - Records the gap-closure deviations and 152-test integrated evidence for PR #54.

## Decisions Made

- Byte limits supplement rather than replace code-point limits because the two measurements defend different boundaries: policy complexity and filesystem
  representation size.
- `decodeURI` is measured only after encoded-separator screening and valid decoding, matching Hono's filesystem path representation while retaining reserved
  escapes such as `%3F`.
- D-12 no longer claims access to raw request-target dot segments after the runtime canonicalizes them; safety is enforced on the normalized pathname and by
  `PUBLIC_DIR` confinement.

## TDD Gate Compliance

- **Task 1 RED:** `deno test -A tests/unit/url.test.ts tests/e2e/blobs.test.ts` produced the two intended failures for the 64-emoji, 256-byte case. The evidence
  file passed `gsd_run check tdd-red-evidence` before implementation.
- **Task 1 GREEN:** Commit `1999ea9` added the generic byte-bound implementation; the focused suite then passed 66 tests, and the tracer feedback gate repeated
  the end-to-end checks successfully.
- **Task 2 test-first expansion:** The new reserved-escape, whole-path, and canonicalization cases passed on their first run because Task 1's generic
  implementation already covered them. No false RED was manufactured and no additional production change was needed; the task remained a regression and
  decision-record expansion.
- **Refactor:** No behavior-neutral refactor was necessary after GREEN.

## Verification

- `deno test -A tests/unit/url.test.ts tests/unit/blob-path.test.ts tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts`
  — 152 passed, 0 failed.
- `deno fmt --check` over all Plan 01-04 source, test, changelog, and decision-record files — passed.
- `deno lint` — 81 files checked, no diagnostics.
- `deno task test` — 356 server tests and 2 client tests passed.
- `v6.4.1` branch and `master` ancestry assertion — passed.
- Unique `Contribution-PR: #53` and `Contribution-PR: #54` trailer assertions — one each.

## Deviations from Plan

None - plan scope and architecture were executed as written. Task 2's test-first additions were already green because the tracer task deliberately implemented
the byte rule generically.

## Issues Encountered

- The initial sandboxed focused run hit the native LibSQL loader's host-network-interface permission boundary; the same command passed in the normal permitted
  execution environment.
- The first warning observer included existing missing-UI-asset startup warnings, so capture was narrowed to the request under test. An older combining-sequence
  control was also corrected to exactly 255 UTF-8 bytes so it remained a valid positive boundary under the new rule.

## Known Stubs

None.

## User Setup Required

None - no external services or configuration changes are required.

## Next Phase Readiness

- The sole reproduced INTK-03 verification blocker is closed with unit, injected-dispatch, and real-adapter evidence.
- Phase 1's envelope and blob-routing guarantees remain green and the release-candidate contribution history remains intact.
- No blocker remains for Phase 2 authorization compatibility work.

## Self-Check: PASSED

- All six planned changed files exist.
- Commits `8a4f310`, `1999ea9`, and `2ec6741` are present on `v6.4.1`.
- No tracked files were deleted and no goal-blocking stubs, skipped tests, or unrun verification commands remain.

---

_Phase: 01-request-intake-boundaries_ _Completed: 2026-10-01_
