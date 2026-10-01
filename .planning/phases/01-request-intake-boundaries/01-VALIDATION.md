---
phase: "01"
slug: "request-intake-boundaries"
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-09-30"
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**          | Deno 2 built-in test runner + `@std/assert`                                                                                                                             |
| **Config file**        | `deno.json`                                                                                                                                                             |
| **Quick run command**  | `deno test -A tests/unit/url.test.ts tests/unit/envelope.test.ts tests/unit/blob-path.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts` |
| **Full suite command** | `deno task test`                                                                                                                                                        |
| **Estimated runtime**  | ~60 seconds                                                                                                                                                             |

---

## Sampling Rate

- **After every task commit:** Run the focused test command named by that task, then `deno fmt`, `deno fmt --check`, and `deno lint`.
- **After every plan wave:** Run `deno task test`.
- **Before `$gsd-verify-work`:** Full suite and branch assertion must be green.
- **Max feedback latency:** 60 seconds for focused verification.

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement                        | Threat Ref       | Secure Behavior                                                                                                                         | Test Type                     | Automated Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | File Exists | Status   |
| -------- | ---- | ---- | ---------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------- |
| 01-01-01 | 01   | 1    | INTK-01                            | —                | Contribution decisions include every D-15 field, attribution, explicit dispositions, and the locked D-11 metric                         | documentation assertion       | `deno eval 'const t = await Deno.readTextFile(".planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md"); for (const token of ["## PR #53", "## PR #54", "## PR #62", "## PR #63", "## PR #64", "@mptfire", "Original intent", "Affected files and behavior", "Protocol or security basis", "Patch-release fit", "Disposition", "Required deviations", "Regression evidence", "Resulting phase", "Integration commit"]) if (!t.includes(token)) throw new Error(`missing ${token}`);'` | ✅          | ✅ green |
| 01-02-01 | 02   | 1    | INTK-02                            | T-01-01          | A hostile multipart PUT is rejected before malformed auth and cancelled without a body pull                                             | unit + e2e                    | `deno test -A tests/unit/envelope.test.ts tests/e2e/upload.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅          | ✅ green |
| 01-02-02 | 02   | 1    | INTK-02, INTK-07                   | T-01-01          | All four upload/media PUT/HEAD surfaces reject envelope MIME while accepted raw requests retain existing behavior                       | unit + e2e + git assertion    | `deno test -A tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                            | ✅          | ✅ green |
| 01-02-03 | 02   | 1    | INTK-07                            | —                | PR #53 evidence has a full SHA and exactly one attributed integration commit                                                            | documentation + git assertion | `test "$(git rev-list --count --extended-regexp --grep='^Contribution-PR: #53$' master..HEAD)" = "1"`                                                                                                                                                                                                                                                                                                                                                                                                  | ✅          | ✅ green |
| 01-03-01 | 03   | 1    | INTK-03                            | T-01-02          | A malformed blob/static path falls through to 404 without invoking static middleware                                                    | unit + e2e                    | `deno test -A tests/unit/blob-path.test.ts tests/e2e/blobs.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅          | ✅ green |
| 01-03-02 | 03   | 1    | INTK-03, INTK-07                   | T-01-02          | Exact blob grammar, cosmetic suffix behavior, unsafe static bypass, safe static eligibility, and Unicode code-point limits are enforced | unit + e2e + git assertion    | `deno test -A tests/unit/blob-path.test.ts tests/unit/url.test.ts tests/e2e/blobs.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                             | ✅          | ✅ green |
| 01-03-03 | 03   | 1    | INTK-07                            | —                | Both Phase 1 contributions have full-SHA evidence and exactly one attributed integration commit each                                    | documentation + git assertion | `test "$(git rev-list --count --extended-regexp --grep='^Contribution-PR: #53$' master..HEAD)" = "1" && test "$(git rev-list --count --extended-regexp --grep='^Contribution-PR: #54$' master..HEAD)" = "1"`                                                                                                                                                                                                                                                                                           | ✅          | ✅ green |
| 01-04-01 | 04   | 4    | INTK-03                            | T-01-13, T-01-15 | Static admission enforces exact UTF-8 byte limits on Hono's filesystem-facing representation without rejecting safe controls            | unit + real-adapter e2e       | `deno test -A tests/unit/url.test.ts tests/e2e/blobs.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅          | ✅ green |
| 01-04-02 | 04   | 4    | INTK-01, INTK-02, INTK-03, INTK-07 | T-01-14, T-01-16 | Request canonicalization stays confined to `PUBLIC_DIR`, byte-bound regressions remain green, and contribution evidence stays intact    | integrated tests + assertions | `deno test -A tests/unit/url.test.ts tests/unit/blob-path.test.ts tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts`                                                                                                                                                                                                                                                                                                                                | ✅          | ✅ green |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [x] `tests/unit/envelope.test.ts` — base MIME normalization and negative/positive envelope matrix.
- [x] `tests/unit/blob-path.test.ts` — exact blob grammar and normalization matrix.
- [x] `tests/unit/url.test.ts` — decoded and encoded static-candidacy boundaries.
- [x] Upload, media, and blob E2E tests — middleware order, cancellation/no-processing, MIME, and routing behavior.
- [x] `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` — review schema and upstream decisions.

No framework installation or test configuration changes are required.

---

## Manual-Only Verifications

| Behavior                                                                                                    | Requirement | Why Manual | Test Instructions |
| ----------------------------------------------------------------------------------------------------------- | ----------- | ---------- | ----------------- |
| None. Branch, ancestry, commit-count, contribution-record, and behavior checks all have automated commands. |             |            |                   |

---

## Validation Audit 2026-10-01

| Metric                                | Count |
| ------------------------------------- | ----- |
| Requirements audited                  | 4     |
| Gaps found                            | 0     |
| Resolved by existing behavioral tests | 4     |
| Escalated                             | 0     |

- Integrated Phase 01 suite: 145 passed, 0 failed.
- Documentation schema, locked Unicode metric, branch ancestry, and unique PR #53/#54 trailer assertions passed.
- No validation-only test files were needed; the existing tests are behavioral and fail on the required request-boundary regressions.
- Infrastructure caveat: `AGENTS.md` references `TESTING.md`, but that file is absent in this checkout. Existing Deno tests and `deno.json` supplied the
  applicable conventions and commands.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or completed Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all formerly missing references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-10-01

## Validation Audit 2026-10-01 — Gap Closure

| Metric                               | Count |
| ------------------------------------ | ----- |
| Gap-closure tasks audited            | 2     |
| Additional behavioral tests observed | 7     |
| Gaps found                           | 0     |
| Escalated                            | 0     |

- Updated integrated Phase 01 focused suite: 152 passed, 0 failed.
- Plan 01-04 adds direct unit, injected-dispatch, and real Hono/Deno adapter coverage for UTF-8 segment/path limits and Request canonicalization.
- The full suite passed with 356 server tests and 2 client tests.
