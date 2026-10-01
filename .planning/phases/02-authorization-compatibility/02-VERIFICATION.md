---
phase: 02-authorization-compatibility
verified: 2026-10-01T18:28:58Z
status: passed
score: 6/6 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md
  - .planning/phases/02-authorization-compatibility/02-01-PLAN.md
  - .planning/phases/02-authorization-compatibility/02-01-SUMMARY.md
  - CHANGELOG.md
  - src/middleware/auth.ts
  - src/routes/upload.ts
  - tests/e2e/delete.test.ts
  - tests/e2e/list.test.ts
  - tests/e2e/upload.test.ts
  - tests/unit/auth.test.ts
covered_digest: "v1:sha256:0e45c40b37773c52d52bd07ae4eaa2f98419f4ebb9ebbc4d29b95b644b28eb9a"
behavior_unverified: 0
overrides_applied: 0
prohibitions_flagged: 0
prohibitions_confirmed:
  - statement: "MUST NOT impose a maximum future authorization lifetime, a fixed digit-count lifetime policy, or any rejection based solely on how far a safe expiration lies in the future."
    status: confirmed
    evidence: "No cap exists in production code; unit and E2E tests accept a signed expiration 31 days ahead."
    confirmed_by: user
    confirmed_at: 2026-10-01T18:28:58Z
  - statement: "MUST NOT erase @mptfire attribution or obscure that the local integration intentionally excludes PR #62's fixed 30-day lifetime cap."
    status: confirmed
    evidence: "CHANGELOG.md credits @mptfire/#62 and the contribution review records the excluded cap and immutable integration SHA."
    confirmed_by: user
    confirmed_at: 2026-10-01T18:28:58Z
decision_coverage:
  honored: 0
  total: 0
  not_honored: []
deferred_warnings:
  - id: WR-04
    finding: "E2E setup and teardown are filter-unsafe."
    reason: "Pre-existing cross-suite harness debt; unrelated to Phase 2 authorization semantics."
  - id: WR-05
    finding: "A storage commit can outlive a failed metadata insert."
    reason: "Pre-existing storage-consistency design issue; unrelated to Phase 2 authorization semantics."
---

# Phase 2: Authorization Compatibility Verification Report

**Phase Goal:** As a Blossom server operator, I want to accept only correctly scoped BUD-11 authorization while honoring safe future expirations, so that
protected blob operations stay secure without rejecting compatible clients. **Verified:** 2026-10-01T18:28:58Z **Status:** passed **Re-verification:** Yes —
after human confirmation

## User Flow Coverage

User story: “As a Blossom server operator, I want to accept only correctly scoped BUD-11 authorization while honoring safe future expirations, so that protected
blob operations stay secure without rejecting compatible clients.”

| Step                                   | Expected                                                                                                                                               | Evidence                                                                                                                                    | Status |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Present correctly scoped authorization | A protected upload, preflight, or deletion accepts a signed event whose `x` tag matches the target blob                                                | Exact-scope enforcement in `src/routes/upload.ts:72-97,242-264,398-416` and `src/routes/delete.ts:55-67`; passing PUT/HEAD/DELETE E2E cases | ✓      |
| Present missing or mismatched scope    | The operation returns 403 and does not upload or delete the target                                                                                     | `tests/e2e/upload.test.ts:522-631,783-829` and `tests/e2e/delete.test.ts:276-318`; focused suite passed                                     | ✓      |
| Present expiration boundaries          | Malformed/unsafe values return 400, expired values return 401, and a safe value beyond 30 days succeeds                                                | `src/middleware/auth.ts:109-128`; `tests/unit/auth.test.ts:143-199`; long-future E2E at `tests/e2e/upload.test.ts:633-656`                  | ✓      |
| Outcome                                | Protected operations are hash-scoped while compatible Base64, audience, signature, verb, headerless preflight, and long-future clients remain accepted | 91-test focused suite passed; compatibility cases span `tests/unit/auth.test.ts` and `tests/e2e/upload.test.ts`                             | ✓      |

## Goal Achievement

### Observable Truths

| # | Truth                                                                                                                                      | Status     | Evidence                                                                                                                                                                                   |
| - | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | A protected operation rejects authorization lacking the required matching blob-hash `x` tag and accepts an otherwise valid matching event. | ✓ VERIFIED | `requireXTag()` is a positive exact-match predicate at `src/middleware/auth.ts:241-247`; PUT/HEAD/DELETE route tests exercise missing, mismatched, and matching scope and passed.          |
| 2 | Malformed, non-integer, unsafe, or expired expiration values are rejected, while safe future values remain accepted beyond 30 days.        | ✓ VERIFIED | Whole-string decimal validation, safe-integer conversion, and `< now` expiry occur at `src/middleware/auth.ts:109-128`; unit and signed E2E boundary tests passed.                         |
| 3 | Focused PR #62 regressions pass without changing valid existing-client behavior.                                                           | ✓ VERIFIED | Independent run completed with 91 passed, 0 failed, including standard/Base64url, server-tag, signature, verb, and real signed route coverage.                                             |
| 4 | Protected HEAD `/upload` enforces scope for a valid supplied `X-SHA-256` but keeps the hash header optional.                               | ✓ VERIFIED | Route branches at `src/routes/upload.ts:72-97`; missing/mismatch/match/headerless cases at `tests/e2e/upload.test.ts:1104-1172` all passed.                                                |
| 5 | Early known-hash upload denial cancels before worker/storage work, and deferred denial aborts staging before commit or metadata insertion. | ✓ VERIFIED | Ordering is explicit at `src/routes/upload.ts:242-264,333-416`; behavioral tests assert zero pulls plus one cancel and unchanged `.tmp` plus a 404, and passed.                            |
| 6 | PR #62 is adapted without its fixed cap and remains traceable through credit, review evidence, and one non-merge trailer-bearing commit.   | ✓ VERIFIED | `CHANGELOG.md:7-8`, contribution review `:79-101`, branch `v6.4.1`, master ancestry, and exactly one non-merge `Contribution-PR: #62` commit (`3f68b6aebc87738a79d63181c06ce90b743ee229`). |

**Score:** 6/6 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact                                                                  | Expected                                                    | Status     | Details                                                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/middleware/auth.ts`                                                  | Strict expiration and exact required scope                  | ✓ VERIFIED | Exists; substantive validation at lines 109-128 and scope helper at 241-247; globally wired through `src/server.ts:50-51` and route imports. |
| `src/routes/upload.ts`                                                    | Known/deferred hash enforcement and cleanup                 | ✓ VERIFIED | Exists; substantive HEAD/PUT branches; both `requireXTag()` calls and `abortWrite()` occur before commit.                                    |
| `tests/unit/auth.test.ts`                                                 | Parser, scope, encoding, and compatibility matrix           | ✓ VERIFIED | 33 active real-signed-event tests; no disabled tests; value/status assertions cover all parser/helper boundaries.                            |
| `tests/e2e/upload.test.ts`                                                | Protected PUT/HEAD scope, cleanup, and long-future coverage | ✓ VERIFIED | 41 active full-app tests; behavioral assertions cover request cancellation, staging cleanup, metadata absence, and compatibility.            |
| `tests/e2e/delete.test.ts`                                                | Denied non-mutation and matching deletion                   | ✓ VERIFIED | 9 active full-app tests; denied GET/HEAD retention and successful 204 deletion are asserted.                                                 |
| `tests/e2e/list.test.ts`                                                  | Hash-scoped authenticated seed upload                       | ✓ VERIFIED | Setup computes the body SHA-256 and signs it into the `x` tag at lines 112-128.                                                              |
| `CHANGELOG.md`                                                            | Credited Unreleased PR #62 patch entry                      | ✓ VERIFIED | Lines 3-8 contain one Patch Changes entry crediting @mptfire and linking #62.                                                                |
| `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` | Adaptation rationale, focused evidence, and immutable SHA   | ✓ VERIFIED | Lines 79-101 explicitly record adaptation, excluded cap, evidence, contributor, and full integration SHA.                                    |

**Artifacts:** 8/8 verified

### Key Link Verification

| From                       | To                         | Via                                                                  | Status  | Details                                                                                                        |
| -------------------------- | -------------------------- | -------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `src/middleware/auth.ts`   | `src/routes/upload.ts`     | Parsed auth plus exact `requireXTag(auth, hash)` checks              | ✓ WIRED | Known hash is checked at lines 252-264; computed hash at 398-416.                                              |
| `src/middleware/auth.ts`   | `src/routes/delete.ts`     | Shared exact-scope helper before ownership mutation                  | ✓ WIRED | `requireXTag(auth, hash)` runs at line 62 before line 65 ownership check and line 74 mutation.                 |
| `src/routes/upload.ts`     | `src/storage/interface.ts` | Early cancel and deferred `abortWrite()`                             | ✓ WIRED | Body cancellation is awaited at line 256; staged cleanup is awaited at line 405 before any commit at line 425. |
| `tests/e2e/upload.test.ts` | `src/routes/upload.ts`     | `app.fetch()` through real middleware, worker, DB, and local storage | ✓ WIRED | Shared full app is constructed at lines 100-136; all 41 tests passed.                                          |
| `CHANGELOG.md`             | Contribution review        | Matching @mptfire/#62 credit and integration evidence                | ✓ WIRED | Both records identify PR #62 and @mptfire; review links the full SHA.                                          |

**Wiring:** 5/5 connections verified

### Data-Flow Trace (Level 4)

Not applicable: Phase 2 changes backend authorization and tests, not artifacts that render dynamic UI data. The request data flow was instead traced from the
global auth middleware (`src/server.ts:50-51`) through route-local verb/scope enforcement and onward to storage/database mutation boundaries.

### Behavioral Spot-Checks

| Behavior                                                                                                          | Command                                                                                                         | Result                                                                   | Status |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| Strict expiration, exact scope, cleanup, HEAD compatibility, DELETE non-mutation, and signed-client compatibility | `deno test -A tests/unit/auth.test.ts tests/e2e/upload.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts` | 91 passed, 0 failed in 930 ms                                            | ✓ PASS |
| Phase source/test formatting                                                                                      | `deno fmt --check` over the eight implementation/evidence files                                                 | Checked 7 format-supported files, no changes required                    | ✓ PASS |
| Phase source/test lint                                                                                            | `deno lint` over six TypeScript source/test files                                                               | Checked 6 files, no diagnostics                                          | ✓ PASS |
| Release-candidate lineage and contribution identity                                                               | Branch/ancestry plus contribution-trailer counts                                                                | `v6.4.1`; master is an ancestor; one total and one non-merge #62 trailer | ✓ PASS |

### Probe Execution

No runnable `probe-*.sh` path is declared by the plan or summary, and no conventional probe script was discovered. The plan's specless classification note is an
explicit unresolved assumption, not a runnable completion probe.

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                                    | Status      | Evidence                                                                                                                             |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| INTK-04     | 02-01       | Integrate safe PR #62 behavior so required `x` tags and expiration integers are validated without a 30-day cap | ✓ SATISFIED | Production predicates, route wiring, 91 passing focused tests, credited changelog/review linkage, and unique trailer-bearing commit. |

No orphaned Phase 2 requirements were found.

### Prohibition Review

Both descriptor-less plan prohibitions are satisfied by deterministic repository evidence and were explicitly confirmed by the user on 2026-10-01.

| Prohibition                                                                 | Automated Evidence                                                       | Human Confirmation | Disposition |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------ | ----------- |
| No maximum future lifetime, digit-count cap, or future-distance rejection   | No cap pattern in production; safe 31-day unit and E2E events pass       | Confirmed by user  | ✓ VERIFIED  |
| Preserve @mptfire attribution and explicit exclusion of PR #62's 30-day cap | `CHANGELOG.md:7-8`; contribution review `:79-101`; unique commit trailer | Confirmed by user  | ✓ VERIFIED  |

### Test Quality Audit

| Test File                  | Linked Req                    | Active | Skipped | Circular | Assertion Level | Verdict                                                        |
| -------------------------- | ----------------------------- | -----: | ------: | -------- | --------------- | -------------------------------------------------------------- |
| `tests/unit/auth.test.ts`  | INTK-04                       |     33 |       0 | No       | Value/status    | Strong                                                         |
| `tests/e2e/upload.test.ts` | INTK-04                       |     41 |       0 | No       | Behavioral      | Strong; whole-file execution is required by the legacy harness |
| `tests/e2e/delete.test.ts` | INTK-04                       |      9 |       0 | No       | Behavioral      | Strong; whole-file execution is required by the legacy harness |
| `tests/e2e/list.test.ts`   | INTK-04 fixture compatibility |      8 |       0 | No       | Behavioral      | Strong; whole-file execution is required by the legacy harness |

**Disabled tests on requirements:** 0\
**Circular patterns detected:** 0\
**Insufficient assertions:** 0

### Anti-Patterns Found

No blocker debt markers, placeholders, disabled requirement tests, circular expected-value generation, or stubs were found in Phase 2's changed files. The
`return null` matches in `extractHostname()` are intended domain behavior, and the fire-and-forget cleanup catches outside the deferred authorization branch
predate this phase.

### Deferred Pre-Existing Warnings

These are not Phase 2 goal gaps and do not change INTK-04 compliance:

| ID    | Finding                                                                                                                | Why Separate From Phase 2                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WR-04 | Upload/delete/list setup and teardown are ordinary tests, so filtering a single E2E case can omit fixtures or cleanup. | Predates the milestone and requires a coordinated three-suite harness migration; the independently run whole focused suite passed 91/91.                  |
| WR-05 | Storage commit precedes metadata insertion, so a DB insert failure can leave an unreachable object.                    | Predates Phase 2 and needs ownership-aware commit results or a pending-upload state across local and S3 storage; no safe narrow authorization fix exists. |

### Decision Coverage

No trackable decisions in CONTEXT.md according to `check.decision-coverage-verify` (`0/0`, non-blocking). The prose decisions were nevertheless checked directly
against implementation and tests in the observable-truth table.

### Assumption Visibility

`INTK-04-unclassified` remains recorded as an unresolved specless-edge assumption in the plan. No extra boundary, adjacency, ordering, encoding, or empty-input
behavior was inferred from it, so it is visible without expanding or blocking the contracted phase scope.

### Human Verification Completed

On 2026-10-01, the user explicitly confirmed both requested checks:

1. No fixed/maximum authorization lifetime was introduced.
2. @mptfire attribution and the explicit exclusion of PR #62's 30-day cap remain present.

### Gaps Summary

**No gaps found.** All six must-have truths, eight artifacts, five key links, INTK-04, and both plan prohibitions are verified. The two pre-existing review
warnings remain separately deferred and do not undermine Phase 2 goal achievement.

---

_Verified: 2026-10-01T18:28:58Z_\
_Verifier: the agent (gsd-verifier)_
