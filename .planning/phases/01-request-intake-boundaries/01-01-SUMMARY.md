---
phase: 01-request-intake-boundaries
plan: 01
subsystem: release-governance
tags: [contribution-intake, git-traceability, blossom, security-review]

requires: []
provides:
  - Five-PR D-15 contribution review with explicit integrate, revise, and assigned-phase dispositions
  - Release-candidate branch and one-attributed-integration-commit contract
  - Locked Unicode code-point interpretation for D-11 path limits
affects: [01-02, 01-03, authorization-compatibility, content-and-logging-boundaries, release-traceability]

actuals:
  tokens: 3385
  tasks: 1
  commits: 1
plan_head_before: 1d4582f1af20dbd4224b76201d3eb862208b7599

tech-stack:
  added: []
  patterns:
    - Fixed D-15 schema for contribution review records
    - One non-merge integration commit per accepted PR with a Contribution-PR trailer

key-files:
  created:
    - .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md
  modified: []

key-decisions:
  - "PRs #53 and #54 require revised Phase 1 integrations rather than direct cherry-picks."
  - "PR #62 retains hash scoping and strict expiration parsing in Phase 2 but excludes the fixed 30-day cap."
  - "PRs #63 and #64 are accepted for Phase 3 integration with their compatibility constraints recorded."
  - "D-11 counts both path-segment and decoded-path limits as Unicode code points via [...text].length."

patterns-established:
  - "Contribution intake: record upstream intent, impact, basis, patch fit, disposition, deviations, evidence, phase, and commit linkage before integration."
  - "Traceability: accepted PRs land once on v6.4.1 as non-merge commits carrying Contribution-PR trailers."

requirements-completed: [INTK-01, INTK-07]

coverage:
  - id: D1
    description: "All five selected PRs have complete D-15 review entries, retained @mptfire attribution, and explicit dispositions."
    requirement: INTK-01
    verification:
      - kind: other
        ref: "deno eval D-15 field and per-PR disposition assertions"
        status: pass
    human_judgment: false
  - id: D2
    description: "The review defines the v6.4.1/master ancestry invariant and one attributed non-merge integration commit per accepted PR."
    requirement: INTK-07
    verification:
      - kind: other
        ref: 'test "$(git branch --show-current)" = "v6.4.1" && git merge-base --is-ancestor master HEAD'
        status: pass
    human_judgment: false
  - id: D3
    description: "The PR #54 deviation locks both D-11 limits to Unicode code points via [...text].length."
    requirement: INTK-01
    verification:
      - kind: other
        ref: "deno eval PR #54 decision-token assertions"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-10-01
status: complete
---

# Phase 1 Plan 1: Contribution Intake and Branch Contract Summary

**Auditable five-PR intake decisions with locked compatibility deviations, contributor attribution, and v6.4.1 integration-commit traceability**

## Performance

- **Duration:** 12 min
- **Started:** 2026-10-01T13:39:47Z
- **Completed:** 2026-10-01T13:52:14Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Reviewed PRs #53, #54, #62, #63, and #64 using every D-15 field while retaining @mptfire and exact upstream titles and URLs.
- Recorded revised Phase 1 boundaries for PRs #53/#54, excluded PR #62's incompatible fixed lifetime cap, and assigned accepted PRs #63/#64 to Phase 3.
- Established the v6.4.1/master ancestry gate, single non-merge integration-commit policy, and `Contribution-PR` trailer requirement.
- Carried forward all eight specless unresolved assumptions, the descriptor-less transparency prohibition, and the resolved D-11 code-point metric.

## Task Commits

Each task was committed atomically:

1. **Task 1: Publish the end-to-end five-contribution review and branch contract** - `ad427d6` (docs)

## Files Created/Modified

- `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` - Five-contribution D-15 review, phase dispositions, compatibility deviations, and
  branch/commit contract.

## Decisions Made

- Adapt PR #53 into pre-auth exact-surface envelope admission with body cancellation rather than using the upstream route-local ordering.
- Adapt PR #54 to the locked tolerant blob grammar and nested static-path policy, excluding its unrelated edit and narrower upstream rules.
- Retain PR #62's hash scoping and strict expiration parsing but omit every fixed 30-day lifetime limit.
- Integrate PRs #63 and #64 in Phase 3 after rebasing them on the earlier request-boundary work.
- Count the 255-character segment and 2,048-character decoded-path limits in Unicode code points via `[...text].length`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The initial GitHub metadata query was blocked by the restricted network sandbox. It was rerun with approved network access, and all five upstream titles,
  URLs, authors, descriptions, and affected-file lists were verified before the review was written.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Pending Evidence by Design

The PR #53/#54 regression results and final integration SHAs remain explicitly pending Plans 01-02 and 01-03, as required by this plan. Later-phase evidence and
SHAs remain assigned to Phases 2 and 3. These are traceability slots for work that has not yet executed, not claimed results or implementation stubs.

## Next Phase Readiness

- Plan 01-02 can implement revised PR #53 against the exact pre-auth, four-surface, cancellation, and attribution contract.
- Plan 01-03 can implement revised PR #54 against the locked blob/static grammar and Unicode code-point limits.
- No blockers remain for the next Phase 1 plan.

## Self-Check: PASSED

- Confirmed the contribution review and summary exist on disk.
- Confirmed task commit `ad427d6` exists and the persisted plan ledger measures one task commit before close-out.
- Re-ran the D-15, disposition, Unicode-metric, assumption, prohibition, formatting, branch, and ancestry assertions successfully.
- Found no stub patterns, skipped tests, unrun verification, or new code-level threat surface.

---

_Phase: 01-request-intake-boundaries_\
_Completed: 2026-10-01_
