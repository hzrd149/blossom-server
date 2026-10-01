---
phase: "02"
slug: "authorization-compatibility"
status: draft
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-01"
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Framework**          | Deno 2 built-in test runner                                                                                     |
| **Config file**        | `deno.json`                                                                                                     |
| **Quick run command**  | `deno test -A tests/unit/auth.test.ts tests/e2e/upload.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts` |
| **Full suite command** | `deno task test`                                                                                                |
| **Estimated runtime**  | ~60 seconds focused; several minutes full suite                                                                 |

---

## Sampling Rate

- **After every task commit:** Run the narrowest affected auth/unit or route test file.
- **After every plan wave:** Run
  `deno test -A tests/unit/auth.test.ts tests/e2e/upload.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts`.
- **Before `$gsd-verify-work`:** `deno fmt --check`, `deno lint`, and `deno task test` must be green.
- **Max feedback latency:** 90 seconds for focused tests.

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Threat Ref                         | Secure Behavior                                                                                                                   | Test Type                | Automated Command                                                                                               | File Exists | Status     |
| -------- | ---- | ---- | ----------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| 02-01-01 | 01   | 1    | INTK-04     | T-02-01, T-02-02, T-02-03, T-02-04 | Strict expiration, exact scope, upload cleanup, and signed-client compatibility work through the protected PUT tracer             | unit + e2e               | `deno test -A tests/unit/auth.test.ts tests/e2e/upload.test.ts`                                                 | ✅          | ⬜ pending |
| 02-01-02 | 01   | 1    | INTK-04     | T-02-02, T-02-04, T-02-05          | Protected HEAD/DELETE scope, fixture compatibility, long-future acceptance, and the single PR #62 integration commit are verified | e2e + integration        | `deno test -A tests/unit/auth.test.ts tests/e2e/upload.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts` | ✅          | ⬜ pending |
| 02-01-03 | 01   | 1    | INTK-04     | T-02-05                            | PR #62 identity is backfilled and focused tests, format, lint, full suite, branch ancestry, and contribution-trailer gates pass   | integration + full suite | `deno task test`                                                                                                | ✅          | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have an automated verification target.
- [x] Sampling continuity has no three consecutive tasks without automated verification.
- [x] Wave 0 has no missing references.
- [x] Commands use no watch-mode flags.
- [x] Focused feedback latency target is below 90 seconds.
- [x] `nyquist_compliant: true` is set in frontmatter.

**Approval:** approved 2026-10-01
