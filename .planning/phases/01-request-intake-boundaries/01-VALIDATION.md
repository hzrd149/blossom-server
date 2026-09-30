---
phase: "01"
slug: "request-intake-boundaries"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-30"
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno 2 built-in test runner + `@std/assert` |
| **Config file** | `deno.json` |
| **Quick run command** | `deno test -A tests/unit/url.test.ts tests/unit/envelope.test.ts tests/unit/blob-path.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts` |
| **Full suite command** | `deno task test` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run the focused test command named by that task, then `deno fmt`, `deno fmt --check`, and `deno lint`.
- **After every plan wave:** Run `deno task test`.
- **Before `$gsd-verify-work`:** Full suite and branch assertion must be green.
- **Max feedback latency:** 60 seconds for focused verification.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | INTK-01 | — | Contribution decisions include security and protocol evidence | documentation | `rg -n -e '#53' -e '#54' -e '#62' -e '#63' -e '#64' .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | INTK-02 | T-01-01 | Rejected envelopes are denied before auth and body consumption | unit + e2e | `deno test -A tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts` | Unit ❌ W0; E2E ✅ extend | ⬜ pending |
| 01-01-03 | 01 | 1 | INTK-03 | T-01-02 | Malformed blob/static paths never reach storage or static-file handling | unit + e2e | `deno test -A tests/unit/blob-path.test.ts tests/unit/url.test.ts tests/e2e/blobs.test.ts` | Parser ❌ W0; URL/E2E ✅ extend | ⬜ pending |
| 01-01-04 | 01 | 1 | INTK-07 | — | Implementation remains attributable to the release-candidate branch | git assertion | `test "$(git branch --show-current)" = "v6.4.1" && git merge-base --is-ancestor master HEAD` | Manual gate | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/envelope.test.ts` — base MIME normalization and negative/positive envelope matrix.
- [ ] `tests/unit/blob-path.test.ts` — exact blob grammar and normalization matrix.
- [ ] Extend `tests/unit/url.test.ts` — decoded and encoded static-candidacy boundaries.
- [ ] Extend upload, media, and blob E2E tests — middleware order, cancellation/no-processing, MIME, and routing behavior.
- [ ] `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` — review schema and upstream decisions.

No framework installation or test configuration changes are required.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Release-candidate branch traceability | INTK-07 | Depends on git branch and commit topology | Confirm current branch is `v6.4.1`, `master` is an ancestor, and each accepted contribution has one attributed integration commit. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
