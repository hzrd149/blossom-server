---
phase: "05"
slug: "v6-4-1-release"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-06"
---

# Phase 05 — Validation Strategy

> Validation contract for release preparation, remote gates, tagging, and publication.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno 2.9.5 built-in test runner plus structural Git/GitHub/JSR assertions |
| **Config file** | `deno.json`; GitHub workflows under `.github/workflows/` |
| **Quick run command** | `deno fmt --check && deno lint && deno check --frozen main.ts` |
| **Full suite command** | `deno task test` |
| **Estimated runtime** | ~1 minute for Deno checks; build, CI, and registry gates are longer-running |

## Sampling Rate

- **After every preparation commit:** Run quick Deno checks, manifest assertions, and `git diff --check`.
- **Before opening the release PR:** Run the complete local release gate on the exact clean preparation SHA.
- **Before merge:** Re-read the PR head and all expected check conclusions; a head change invalidates earlier evidence.
- **Before tag push and publication:** Re-run SHA/version/cleanliness assertions and the publish dry-run.
- **Before phase verification:** Require complete receipts for preparation, PR checks, merge, tag, GHCR workflow, and JSR 6.4.1.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | RELS-01, RELS-02 | release metadata integrity | All accumulated notes move together and authoritative metadata reports 6.4.1 | structural | Checklist assertions plus `git diff --check` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | RELS-03, RELS-04 | artifact/provenance substitution | Exact preparation SHA passes local gates and links all five contributions | build/audit | Deno, asset, Docker, Nix, dry-run, and ledger assertions | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | RELS-05 | stale PR head/check bypass | Latest release PR head has every expected successful check before merge | remote integration | `gh pr view` and `gh pr checks --watch` plus blocking-human merge checkpoint | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 3 | RELS-06 | wrong tag/publication origin | Tag and JSR package resolve to exact merged master SHA/version | remote integration | Git ref equality, registry receipts, and blocking-human tag/publish checkpoints | ❌ W0 | ⬜ pending |

## Wave 0 Requirements

- [ ] Release checklist document with commands, expected outcomes, invalidation rules, and three blocking-human checkpoints.
- [ ] Release evidence ledger seeded with Phase 1/4 identities and explicit pending remote receipts.
- [ ] Structural changelog/version assertions embedded in the checklist.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Merge release PR | RELS-05 | Irreversible remote mutation | Confirm exact PR/head/check evidence, then explicitly authorize merge |
| Push `v6.4.1` tag | RELS-06 | Irreversible public Git/GHCR trigger | Confirm merged master SHA and exact tag target, then explicitly authorize one-ref push |
| Publish JSR package | RELS-06 | Immutable registry publication and interactive authorization | Confirm tag/HEAD/version/dry-run, then explicitly authorize publication |

## Validation Sign-Off

- [ ] All tasks have automated verification or an explicit blocking-human checkpoint
- [ ] No release mutation uses stale SHA/check evidence
- [ ] No watch-mode flags
- [ ] All remote receipts are retained without credentials/device codes
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
