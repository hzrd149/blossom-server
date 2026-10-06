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
| 05-01-01 | 01 | 1 | RELS-01, RELS-02, RELS-03, RELS-04 | release metadata integrity | All accumulated notes move together, authoritative metadata reports 6.4.1, and checklist/evidence schemas exist | structural | Deno structural assertions, `deno fmt --check`, and `git diff --check` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | RELS-03, RELS-05 | artifact/provenance substitution | Exact preparation SHA passes all local gates before the release PR opens at that SHA | build/audit | Deno, asset, Docker, Nix, dry-run, and GitHub PR identity assertions | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | RELS-01, RELS-05 | stale PR head/check bypass | Latest release PR head/date has every expected and observed check completed successfully | remote integration | `gh pr view`, `statusCheckRollup`, remote-tip equality, and release-day assertion | ✅ existing workflows | ⬜ pending |
| 05-02-02 | 02 | 2 | RELS-05 | unapproved merge | Human sees current exact head/check evidence before merge | blocking-human | Same read-only PR/check predicate immediately before authorization | ✅ CLI assertion | ⬜ pending |
| 05-02-03 | 02 | 2 | RELS-05, RELS-06 | merge race / wrong master | Guarded merge result equals fetched master and contains reviewed head | remote integration | `--match-head-commit`, merge/fetch/ancestry/version assertions | ✅ CLI assertion | ⬜ pending |
| 05-03-01 | 03 | 3 | RELS-02, RELS-06 | wrong tag origin | Local master and peeled local tag equal exact release merge SHA; remote tag is absent | Git integration | Local/fetched master, tag, version, and remote-absence assertions | ✅ Git assertions | ⬜ pending |
| 05-03-02 | 03 | 3 | RELS-06 | unapproved tag push | Human sees exact tag target/refspec and GHCR side effects before push | blocking-human | Repeated SHA equality and remote-absence predicate | ✅ CLI assertion | ⬜ pending |
| 05-03-03 | 03 | 3 | RELS-06 | broad/wrong tag publication | One exact tag ref is public at merge SHA and tag-triggered GHCR workflow succeeds | remote integration | Remote tag readback and SHA-bound GitHub Actions receipt | ✅ workflow exists | ⬜ pending |
| 05-04-01 | 04 | 4 | RELS-06 | dirty or wrong-source package | Clean master worktree equals local/remote tag and passes fresh native Deno dry-run | integration | Git equality, registry absence, frozen check, and `deno publish --dry-run --check=all` | ✅ Deno CLI | ⬜ pending |
| 05-04-02 | 04 | 4 | RELS-06 | unapproved immutable publication | Human sees exact SHA/package/dry-run evidence before live publish | blocking-human | Repeated clean-tree/tag/version/dry-run predicate | ✅ CLI assertion | ⬜ pending |
| 05-04-03 | 04 | 4 | RELS-03, RELS-04, RELS-06 | wrong package or falsified receipts | JSR 6.4.1 is public and actual receipts are submitted by one-file docs-only PR without moving tag | remote integration/audit | JSR metadata, tag equality, docs-PR diff, and ledger completeness assertions | ❌ W0 ledger | ⬜ pending |

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
