---
phase: 01-request-intake-boundaries
verified: 2026-10-01T16:08:07Z
status: passed
score: 6/8 must-haves verified
covered_files:

  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/01-request-intake-boundaries/01-01-PLAN.md
  - .planning/phases/01-request-intake-boundaries/01-01-SUMMARY.md
  - .planning/phases/01-request-intake-boundaries/01-02-PLAN.md
  - .planning/phases/01-request-intake-boundaries/01-02-SUMMARY.md
  - .planning/phases/01-request-intake-boundaries/01-03-PLAN.md
  - .planning/phases/01-request-intake-boundaries/01-03-SUMMARY.md
  - .planning/phases/01-request-intake-boundaries/01-04-PLAN.md
  - .planning/phases/01-request-intake-boundaries/01-04-SUMMARY.md
  - .planning/phases/01-request-intake-boundaries/01-CONTEXT.md
  - .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md
  - .planning/phases/01-request-intake-boundaries/01-REVIEW.md
  - .planning/phases/01-request-intake-boundaries/01-SECURITY.md
  - .planning/phases/01-request-intake-boundaries/01-VALIDATION.md
  - .planning/phases/01-request-intake-boundaries/SKELETON.md
  - .planning/phases/01-request-intake-boundaries/deferred-items.md
  - AGENTS.md
  - CHANGELOG.md
  - src/middleware/envelope.ts
  - src/routes/blobs.ts
  - src/server.ts
  - src/utils/mime.ts
  - src/utils/url.ts
  - tests/e2e/blobs.test.ts
  - tests/e2e/media.test.ts
  - tests/e2e/upload.test.ts
  - tests/unit/blob-path.test.ts
  - tests/unit/envelope.test.ts
  - tests/unit/url.test.ts

covered_digest: "v1:sha256:58436d7f80be37b484c738a3cccc07652f675c31cacbb4d8fe680d85fa079337"
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 6/8
  gaps_closed:
    - "Static candidacy now bounds the exact Hono/Deno filesystem-facing representation and real-adapter regressions cover retained escapes, multibyte segments, whole-path overflow, and Request canonicalization."
  gaps_remaining: []
  regressions: []
deferred:

  - truth: "Every selected contribution is already integrated on v6.4.1."
    addressed_in: "Phases 2 and 3"
    evidence: "Phase 2 integrates PR #62; Phase 3 integrates PRs #63 and #64. Phase 1 integrates PRs #53 and #54 and records all five dispositions."
advisory: []
behavior_unverified_items:

  - truth: "Malformed blob/static paths are rejected before filesystem handling while valid hash paths and safe assets remain compatible."
    test: "Run the real-adapter overflow regression as an independently runnable named test after initializing its own app/config fixture, then request the exact 256-byte, 258-byte, and 2,049-byte overflow paths."
    expected: "Each overflow returns normal 404, never invokes real serveStatic/onNotFound, and emits no filesystem warning; exact-boundary controls reach the adapter."
    why_human: "The implementation and integrated suite are green, but the exact-name verifier run fails before the behavior executes because the test depends on a separate Deno.test setup case filtered out by --filter."
unverified_prohibitions:

  - statement: "MUST NOT erase or misstate contributor attribution, or conceal material deviations from the upstream pull request, in the contribution review record."
    disposition: "unverified-prohibition — human review recommended"
    llm_judgment: "Appears satisfied: all five entries retain @mptfire attribution and explicitly identify required deviations, but the descriptor-less judgment-tier prohibition has no authoritative human acceptance."
human_verification:

  - test: "Accept or reject the independently runnable evidence for the real-adapter ordering invariant."
    expected: "The 256-byte, 258-byte, and 2,049-byte paths bypass filesystem middleware without warnings, while exact controls reach it."
    why_human: "The focused suite passes the behavior, but the mandated exact-name test path is fixture-order-dependent and fails before reaching the assertion."
  - test: "Review all five contribution entries against the upstream PRs for attribution and material deviations."
    expected: "@mptfire attribution is accurate and no material deviation is omitted or misstated."
    why_human: "This PLAN prohibition is judgment-tier and descriptor-less, so automated review is non-authoritative."
---

# Phase 1: Request Intake Boundaries Verification Report

**Phase Goal:** Selected contributions are reviewed and upload/blob requests are rejected safely at the protocol boundary.\
**Verified:** 2026-10-01T16:08:07Z\
**Status:** human_needed\
**Re-verification:** Yes — after Plan 01-04 gap closure

## Goal Achievement

### Observable Truths

The prior report's eight-truth contract is retained. The carried-forward filesystem-boundary gap received full verification; previously passing truths received
regression checks.

| # | Truth                                                                                                                                             | Status                         | Evidence                                                                                                                                                                                                                                                                  |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Maintainer can inspect all five selected PRs with explicit decisions against code, protocol, patch scope, and security constraints.               | ✓ VERIFIED                     | `01-CONTRIBUTION-REVIEW.md` contains separate #53/#54/#62/#63/#64 sections, every D-15 field, @mptfire attribution, dispositions, deviations, evidence, phase, and commit linkage.                                                                                        |
| 2 | Multipart or URL-encoded `PUT /upload` is rejected without storing or buffering its envelope, while a raw BUD-02 body still uploads successfully. | ✓ VERIFIED                     | `envelopeAdmissionMiddleware` awaits body cancellation before 415; the integrated focused run passed cancellation/no-pull and raw-upload behavior. This previously passing truth received a regression check.                                                             |
| 3 | A malformed blob/static path is rejected before filesystem handling, while valid hash paths with reasonable extensions resolve normally.          | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code, wiring, exact byte bounds, real-adapter assertions, and the integrated run are present. The exact-name real-adapter test fails during fixture setup (`config` undefined) when isolated, so the ordering invariant cannot receive a clean single-test certification. |
| 4 | Focused regressions for PRs #53 and #54 pass alongside existing upload and blob-retrieval behavior.                                               | ✓ VERIFIED                     | Independent run of all six focused files: 152 passed, 0 failed.                                                                                                                                                                                                           |
| 5 | Milestone work and every selected contribution are integrated on `v6.4.1`, not directly on `master`.                                              | → DEFERRED                     | Current branch is `v6.4.1`, `master` is an ancestor, and PRs #53/#54 have exactly one trailer-bearing integration commit each. PR #62 and PRs #63/#64 are explicitly owned by Phases 2 and 3.                                                                             |
| 6 | The contribution record locks both D-11 length limits to Unicode code points via `[...text].length`.                                              | ✓ VERIFIED                     | The PR #54 record retains the 255/2,048 limits and documents the supplemental 255/2,048 filesystem-byte bounds.                                                                                                                                                           |
| 7 | PUT/HEAD upload and media envelope surfaces reject before auth while accepted requests continue to existing behavior.                             | ✓ VERIFIED                     | `src/server.ts` orders CORS → envelope admission → auth. The four exact surfaces and accepted controls pass in the focused run.                                                                                                                                           |
| 8 | Cosmetic blob suffixes never control storage lookup or response `Content-Type`; stored metadata remains authoritative.                            | ✓ VERIFIED                     | `extractBlobHash` returns only the normalized address; `getBlob`, `mimeToExt(blob.type)`, storage access, and response MIME all use stored metadata. GET/HEAD mismatch controls pass.                                                                                     |

**Score:** 6/8 truths verified (1 present, behavior-unverified; 1 roadmap item deferred to later phases)

### Deferred Items

| # | Item                                                         | Addressed In   | Evidence                                                                                                                          |
| - | ------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Remaining selected contributions are integrated on `v6.4.1`. | Phases 2 and 3 | Phase 2 owns PR #62; Phase 3 owns PRs #63 and #64. Their Phase 1 review entries preserve release-branch and trailer requirements. |

### Advisory (New Scope, Unevidenced)

None. The exact-name test isolation issue is deterministically reproduced and reported as behavior-unverified/test-quality warning, not an unevidenced advisory.

### Required Artifacts

| Artifact                                                                  | Expected                                                       | Status     | Details                                                                                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` | Five-PR review and traceability                                | ✓ VERIFIED | Substantive five-entry D-15 record linked to changelog and git history.                                                                                  |
| `.planning/phases/01-request-intake-boundaries/SKELETON.md`               | Existing application contract                                  | ✓ VERIFIED | Substantive planning contract; no redundant scaffold.                                                                                                    |
| `src/middleware/envelope.ts`                                              | Pre-auth admission and cancellation                            | ✓ VERIFIED | Exported, imported by `server.ts`, invokes the MIME classifier, awaits PUT cancellation, then returns 415.                                               |
| `src/utils/mime.ts`                                                       | Envelope MIME classifier                                       | ✓ VERIFIED | Exported and used; normalizes the base MIME and rejects exact envelope families.                                                                         |
| `src/routes/blobs.ts`                                                     | Exact blob parser and metadata-driven retrieval                | ✓ VERIFIED | Anchored parser runs before DB/storage access; stored MIME drives extension and response type.                                                           |
| `src/utils/url.ts`                                                        | Filesystem-safe static candidacy                               | ✓ VERIFIED | Enforces encoded-separator rejection, guarded dual decoding, code-point limits, UTF-8 byte limits, unsafe-character checks, and safe segments.           |
| `src/server.ts`                                                           | Ordered middleware and candidate-gated static serving          | ✓ VERIFIED | Calls `isStaticCandidate(new URL(ctx.req.url).pathname)` before production/injected static middleware.                                                   |
| `tests/unit/url.test.ts`                                                  | Code-point, byte-boundary, and Request canonicalization matrix | ✓ VERIFIED | Exact 255/256, 2,048/2,049, retained-escape, Unicode, and canonicalization value assertions.                                                             |
| `tests/e2e/blobs.test.ts`                                                 | Injected and real-adapter boundary regressions                 | ⚠️ WARNING | Substantive behavioral assertions pass in the file run, but the target real-adapter test is not independently runnable because setup is a separate test. |
| `tests/unit/blob-path.test.ts`                                            | Blob grammar matrix                                            | ✓ VERIFIED | 18 active value-level cases; no skips.                                                                                                                   |
| `tests/unit/envelope.test.ts`                                             | Envelope MIME matrix                                           | ✓ VERIFIED | 10 active value-level cases; no skips.                                                                                                                   |
| `tests/e2e/upload.test.ts` / `tests/e2e/media.test.ts`                    | Envelope ordering, cancellation, and compatibility             | ✓ VERIFIED | Behavioral cases pass in the integrated focused run.                                                                                                     |

`verify.artifacts` passed all 19 declared artifact entries across Plans 01-01 through 01-04.

### Key Link Verification

| From                         | To                                               | Via                                              | Status  | Details                                                                                                                                              |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server.ts`              | `src/middleware/envelope.ts`                     | CORS → envelope admission → auth                 | ✓ WIRED | Imports and invokes the middleware at lines 18 and 47-51.                                                                                            |
| `src/middleware/envelope.ts` | `src/utils/mime.ts` / `src/middleware/errors.ts` | Classification, cancellation, 415                | ✓ WIRED | Classifier drives rejection; PUT cancellation precedes `errorResponse`.                                                                              |
| `src/server.ts`              | `src/utils/url.ts`                               | Predicate before static middleware               | ✓ WIRED | Lines 55-59 enforce the gate. Automated regex missed the multiline call, but manual control-flow inspection confirms it.                             |
| `src/routes/blobs.ts`        | `src/db/blobs.ts`                                | Normalized hash to `getBlob`                     | ✓ WIRED | Lines 41-55 reject invalid filenames before the metadata lookup. Automated regex missed the multiline flow.                                          |
| `src/routes/blobs.ts`        | storage                                          | Stored MIME to extension/read                    | ✓ WIRED | `mimeToExt(blob.type)` feeds `storage.has/read`; requested suffix is discarded.                                                                      |
| `tests/e2e/blobs.test.ts`    | `src/server.ts`                                  | Real `serveStatic` and injected middleware seams | ✓ WIRED | Imports `serveStatic`, passes it through `buildApp`, records `onNotFound`, and captures warnings. Automated regex missed the multiline relationship. |
| `CHANGELOG.md`               | review/git history                               | Contributor credit and full SHAs                 | ✓ WIRED | @mptfire/#53/#54 entries correspond to the unique trailer-bearing commits.                                                                           |

### Data-Flow Trace (Level 4)

| Artifact           | Data Variable                       | Source                                                                     | Produces Real Data                                                     | Status    |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------- |
| Envelope admission | method, pathname, MIME, body stream | Real `Request`                                                             | Cancels rejected PUT streams or continues to route auth/worker/storage | ✓ FLOWING |
| Blob retrieval     | normalized hash and `blob` metadata | Path parser → LibSQL `getBlob` → storage interface                         | Metadata and storage stream reach the HTTP response                    | ✓ FLOWING |
| Static handling    | canonical pathname                  | `Request.url` → `isStaticCandidate` → Hono `serveStatic` → Deno filesystem | Only byte/code-point-safe candidates reach the real adapter            | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                                              | Command                                                                                                                                                                 | Result                                                                                                                                      | Status |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Real-adapter overflow invariant, exact named test     | `deno test -A --filter 'real static adapter observes exact byte controls and bypasses overflows without warnings' tests/e2e/blobs.test.ts`                              | Fails before behavior: `config` is undefined because the separate setup test is filtered out                                                | ? SKIP |
| Upload cancellation invariant, exact named regression | `deno test -A --filter 'PUT /upload: multipart is cancelled before malformed auth parsing' tests/e2e/upload.test.ts`                                                    | Fails before behavior: shared `appWithAuth` setup is filtered out; previously verified truth remains green in the integrated regression run | ? SKIP |
| Phase 1 focused behavior                              | `deno test -A tests/unit/url.test.ts tests/unit/envelope.test.ts tests/unit/blob-path.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts` | 152 passed, 0 failed; includes real-adapter, cancellation/no-pull, raw upload, grammar, and stored-MIME cases                               | ✓ PASS |
| Targeted formatting                                   | `deno fmt --check` over 14 Phase 1 source/test/artifact files                                                                                                           | Checked 14 files                                                                                                                            | ✓ PASS |
| Targeted lint                                         | `deno lint` over 11 Phase 1 source/test files                                                                                                                           | Checked 11 files                                                                                                                            | ✓ PASS |
| Branch and contribution identity                      | branch, ancestry, and trailer-count assertions                                                                                                                          | `v6.4.1`; master ancestor; #53=1; #54=1                                                                                                     | ✓ PASS |

### Probe Execution

Not applicable. No Phase 1 PLAN/SUMMARY declares a probe and no conventional `scripts/**/tests/probe-*.sh` exists.

### Requirements Coverage

| Requirement | Source Plan                | Description                                                                                                   | Status                  | Evidence                                                                                                                                               |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| INTK-01     | 01-01, 01-04               | Review each selected PR against code, protocol, scope, and security                                           | ✓ SATISFIED             | Complete five-entry review, explicit dispositions/deviations, and updated PR #54 gap evidence.                                                         |
| INTK-02     | 01-02, 01-04               | Reject multipart/urlencoded envelopes without buffering rejected bodies                                       | ✓ SATISFIED             | Pre-auth middleware plus integrated cancellation/no-pull and raw-body regressions.                                                                     |
| INTK-03     | 01-03, 01-04               | Reject malformed blob/static paths before unnecessary filesystem operations without breaking valid extensions | ? NEEDS HUMAN           | Implementation and integrated behavior are green, but the carried-forward ordering invariant lacks a passing independently runnable named test.        |
| INTK-07     | 01-01, 01-02, 01-03, 01-04 | Develop Phase 1 integrations on `v6.4.1`, not directly on `master`                                            | ✓ SATISFIED FOR PHASE 1 | Branch/ancestry pass and #53/#54 each have exactly one attributed integration commit; remaining contributions are explicitly assigned to later phases. |

All requirement IDs declared across the four PLAN frontmatters (`INTK-01`, `INTK-02`, `INTK-03`, `INTK-07`) are accounted for. REQUIREMENTS.md maps no
additional orphaned requirement to Phase 1.

### Anti-Patterns Found

| File                       | Line                   | Pattern                                                                                             | Severity   | Impact                                                                                                        |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/blobs.test.ts`  | 119-166, 249-297       | Behavioral target depends on a separate `Deno.test` setup case and fails under exact-name filtering | ⚠️ Warning | Prevents isolated certification of the filesystem-ordering invariant; does not reproduce a production defect. |
| `tests/e2e/upload.test.ts` | shared setup / 341-376 | Cancellation target likewise depends on file-order setup                                            | ⚠️ Warning | Reduces diagnostic isolation; integrated regression remains green.                                            |

No unreferenced `TBD`, `FIXME`, or `XXX` markers, disabled requirement tests, circular expected-value generation, placeholder implementations, or goal-blocking
stubs were found. Legitimate `return null` cases are parser/fallthrough results, not empty implementations.

### Test Quality Audit

| Test File                                             | Linked Req | Active        | Skipped | Circular | Assertion Level | Verdict                                                                                 |
| ----------------------------------------------------- | ---------- | ------------- | ------- | -------- | --------------- | --------------------------------------------------------------------------------------- |
| `tests/unit/envelope.test.ts`                         | INTK-02    | 10            | 0       | No       | Value           | PASS                                                                                    |
| `tests/e2e/upload.test.ts`, `tests/e2e/media.test.ts` | INTK-02    | Active        | 0       | No       | Behavioral      | WARNING — target cases pass in-file but exact-name execution omits required setup.      |
| `tests/unit/blob-path.test.ts`                        | INTK-03    | 18            | 0       | No       | Value           | PASS                                                                                    |
| `tests/unit/url.test.ts`                              | INTK-03    | 47-file suite | 0       | No       | Value           | PASS — boundary fixtures independently verify byte and code-point oracles.              |
| `tests/e2e/blobs.test.ts`                             | INTK-03    | 24-file suite | 0       | No       | Behavioral      | WARNING — strong real-adapter assertions, but shared setup prevents isolated execution. |

**Disabled tests on requirements:** 0.\
**Circular patterns detected:** 0.\
**Insufficient assertions:** 0.\
**Isolation warnings:** 2 requirement-linked E2E files.

### Decision Coverage

All 17 trackable `01-CONTEXT.md` decisions are honored by shipped artifacts according to the non-blocking decision-coverage gate.

### Prohibition Verification

**unverified-prohibition — human review recommended:** The contribution record appears to preserve @mptfire attribution and disclose material deviations for all
five PRs. Because the prohibition is judgment-tier and has no authoritative human acceptance, it cannot silently pass.

### Human Verification Required

#### 1. Real-adapter ordering invariant

**Test:** Initialize the blob E2E fixture within the named test (or an actual setup hook), then run only
`real static adapter observes exact byte controls and bypasses overflows without warnings`.\
**Expected:** 256-byte, 258-byte, and 2,049-byte overflow paths return 404 without `onNotFound` or warnings; exact controls reach the adapter.\
**Why human:** The current exact-name run fails during fixture initialization rather than exercising the invariant, so the integrated pass needs explicit
acceptance or a self-contained test.

#### 2. Contribution transparency prohibition

**Test:** Compare the five contribution-review entries with upstream PRs #53, #54, #62, #63, and #64.\
**Expected:** @mptfire attribution is accurate and every material local deviation is visible.\
**Why human:** This is a judgment-tier prohibition; automated textual evidence is non-authoritative.

### Gaps Summary

The prior production blocker is closed. `isStaticCandidate` now constrains the exact filesystem-facing representation, the real-adapter regression passes in the
integrated 152-test run, valid boundary controls remain compatible, branch/commit traceability is intact, and there are no remaining blocking gaps.

Phase status is `human_needed`, not `passed`, because the carried-forward ordering invariant cannot be certified through the required isolated named-test path
and the plan retains one unresolved judgment-tier prohibition. No new gap-closure plan is indicated unless the maintainer requires the E2E tests to be
independently runnable before acceptance.

---

_Verified: 2026-10-01T16:08:07Z_\
_Verifier: the agent (gsd-verifier)_
