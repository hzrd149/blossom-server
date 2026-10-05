---
phase: "04"
slug: "integrated-candidate-verification"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-05"
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno built-in test runner 2.9.5 with `@std/assert` 1.0.19 |
| **Config file** | `deno.json`; client sub-suite uses `src/landing/client/deno.json` |
| **Quick run command** | `deno test -P --env-file=.env tests/unit/mime.test.ts tests/e2e/active-content.test.ts` |
| **Full suite command** | `deno task test` |
| **Estimated runtime** | ~60 seconds for focused tests; full package gates are longer-running |

---

## Sampling Rate

- **After every task commit:** Run the smallest focused test command for the files changed.
- **After every plan wave:** Run the contribution regression matrix plus `deno check --frozen main.ts`.
- **Before `$gsd-verify-work`:** Require `deno fmt --check`, `deno lint`, `deno task test`, repeatable asset hashes, a fresh Docker build, and `deno task check:nix` against one unchanged candidate SHA.
- **Max feedback latency:** 60 seconds for focused code/test feedback; packaging gates may exceed this by design.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | VERI-01, VERI-04 | active-content execution | `multipart/x-mixed-replace` is isolated as active content | unit/e2e | `deno test -P --env-file=.env tests/unit/mime.test.ts tests/e2e/active-content.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | VERI-01, VERI-04 | cache-policy bypass | Weak and strong entity tags use RFC weak comparison for GET/HEAD 304 behavior | e2e | `deno test -P --env-file=.env tests/e2e/active-content.test.ts tests/e2e/blobs.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | VERI-01, VERI-02, VERI-04 | — | All selected contribution regressions, Deno checks, and storage interface wiring pass | integration | `deno task test && deno check --frozen main.ts` | ✅ | ⬜ pending |
| 04-02-02 | 02 | 2 | VERI-03 | stale artifact/package output | Repeated assets match and fresh Docker/Nix gates pass for one candidate SHA | package | `deno task build && deno task check:nix` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `tests/unit/mime.test.ts` — exact, mixed-case, and parameterized `multipart/x-mixed-replace` cases plus nearby multipart controls.
- [ ] `tests/e2e/active-content.test.ts` — multipart active content and weak entity-tag coverage across relevant methods/statuses.
- [ ] `src/routes/blobs.ts` or a nearby pure helper — RFC weak comparison without changing emitted ETags.
- [ ] `deno.json` — reconcile documented Nix task names and keep transient `.gsd` state out of the exact formatter gate.
- [ ] `.planning/phases/04-integrated-candidate-verification/04-VERIFICATION-EVIDENCE.md` — retained evidence ledger tied to one candidate SHA.

---

## Manual-Only Verifications

None. Packaging commands may require host tooling and network access, but their outcomes are command-verifiable rather than subjective.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Focused feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
