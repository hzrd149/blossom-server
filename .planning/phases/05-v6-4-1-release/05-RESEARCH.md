# Phase 5: v6.4.1 Release - Research

**Researched:** 2026-10-06  
**Domain:** Maintenance release engineering, GitHub release PR, Git/JSR publication, and release evidence  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Release contents

- Move every current `Unreleased` changelog entry into a new `6.4.1` section dated on the actual release day; do not select only a subset of the accumulated entries.
- Use concise operator-facing release notes while preserving contributor and pull-request attribution.
- Update only authoritative package-version metadata, beginning with `deno.json`, and verify that derived package outputs report 6.4.1; do not perform a broad textual replacement.
- Retain a release checklist and evidence record linking selected PRs, adapted commits, regression tests, changelog entries, the release PR, required CI checks, merge commit, tag, and publication result.

### Release PR and CI

- Open the release PR from `v6.4.1` to `master` only after the version bump, release notes, reusable checklist, and local release gates are committed.
- Every required GitHub check must finish successfully. A pending or failing required check blocks merge; there are no documented exceptions for this release.
- Preserve the release branch's traceable commit history using the repository's normal merge policy rather than squashing the complete release into one commit.
- Record the PR URL and number, reviewed head SHA, required checks and outcomes, merge commit, and resulting merged `master` SHA.

### Tagging and publication

- Create `v6.4.1` only after the release PR merges and local `master` is updated to that verified merge.
- The tag must reference the exact merged `master` commit recorded in release evidence, not the release branch or a later documentation commit.
- Publish the Deno package only from the tagged, merged `master` checkout after verifying version metadata and clean release artifacts.
- Pause for explicit human confirmation immediately before each irreversible remote action: merging the release PR, pushing the `v6.4.1` tag, and publishing the Deno package. These actions must not be auto-approved.

### the agent's Discretion

Planning may choose the exact release-note layout, checklist filename, evidence-table structure, and safe read-only GitHub verification commands while preserving the gates above and repository conventions.

### Deferred Ideas (OUT OF SCOPE)

- PR #55 MIME filtering and PR #60 media configuration/UI changes remain deferred to v6.5.
- Any new feature or broad release-process redesign remains outside v6.4.1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RELS-01 | Users can read accurate v6.4.1 release notes describing every included user-facing fix. | Move the complete six-entry `Unreleased` patch list into one ISO-dated `6.4.1` section, preserve five contribution links/credits, and reuse that section as the PR release summary. [VERIFIED: CHANGELOG.md:3-17] |
| RELS-02 | Maintainer can bump all authoritative package-version references from 6.4.0 to 6.4.1. | Edit the root `deno.json` version only; `flake.nix` derives Nix package versions from it. Verify the manifest, tag/version equality, Nix evaluations, and Deno dry-run output. [VERIFIED: deno.json:3-5; flake.nix:54-59] |
| RELS-03 | Maintainer can produce and verify the v6.4.1 release artifacts using a documented, repeatable release checklist. | Use a committed checklist with SHA-bound local gates, fresh generated assets, no-cache Docker, deterministic Nix, and `deno publish --dry-run --check=all` before any release PR is opened. [VERIFIED: AGENTS.md:44-59,71-73; 04-VERIFICATION-EVIDENCE.md:45-116] |
| RELS-04 | Maintainer can close the milestone with traceability from selected PRs through implementation, tests, changelog entries, and release output. | Seed an evidence matrix from the Phase 1 and Phase 4 ledgers, then append the final PR/check/merge/tag/JSR receipts without rewriting historical evidence. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:25-43,118-123] |
| RELS-05 | Maintainer can open a GitHub release PR from `v6.4.1` to `master` and merge it only after all required CI checks pass. | Record the latest PR head SHA, all check conclusions and URLs, and use a human-only merge checkpoint plus `--match-head-commit`; do not rely on currently absent server-side protection. [CITED: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks] |
| RELS-06 | Maintainer can create and push the `v6.4.1` tag and publish the Deno package only from the merged `master` state. | Prove `HEAD == merged master == v6.4.1^{commit}` before the exact tag push and again before `deno publish`; keep tag push and JSR publication as separate, explicit human confirmations. [CITED: https://git-scm.com/docs/git-rev-parse; https://docs.deno.com/runtime/reference/cli/publish/] |
</phase_requirements>

## Summary

Phase 5 should be planned as a monotonic release state machine, not as another implementation phase. The preparation commit should change only the release-facing sources and any fixed-output hash that a fresh Nix build proves must change: move all six current patch notes into an ISO-dated `6.4.1` section, change the root manifest version from `6.4.0` to `6.4.1`, add a reusable checklist, and seed an evidence ledger. The final preparation head must then pass the complete local release gates before the GitHub release PR is opened. [VERIFIED: CHANGELOG.md:3-17; deno.json:3-5; AGENTS.md:61-87]

The core safety property is commit identity. Every local result belongs to one release-preparation SHA; every GitHub check belongs to the reviewed PR head/test-merge state; the merge receipt yields one merged `master` SHA; the tag peels to that same SHA; and the JSR package is published from a clean checkout at that tag. If any commit changes after review—including a changelog date correction after midnight—the previous head review and checks are stale and the plan must re-run the affected gates. [CITED: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks]

Because the shared checkout already contains unrelated user/planning changes, run the final preparation gates and post-merge publication assertions in clean Git worktrees created from the exact target commits. This preserves the user's files, makes Deno's dirty-tree refusal meaningful, and avoids treating unrelated untracked files as release inputs. [VERIFIED: `git status --short` on 2026-10-06; CITED: https://docs.deno.com/runtime/reference/cli/publish/]

The three irreversible actions must remain distinct human-only checkpoints: release-PR merge, exact tag push, and Deno publication. Opening the PR and running read-only checks can be automated. No merge command, tag-push command, or live `deno publish` command should be placed in an automatically approved task. Tag push also starts the repository's Docker image publishing workflow, so its checkpoint must disclose that secondary effect. [VERIFIED: .github/workflows/docker-image.yml:3-8,14-56; 05-CONTEXT.md:30-35]

**Primary recommendation:** use two plans—(1) reversible release preparation plus full local gates and PR creation, then (2) SHA-bound CI verification and three explicit human checkpoints for merge, tag push, and JSR publication—with an append-only evidence ledger spanning both plans. [VERIFIED: 05-CONTEXT.md:16-39]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Release notes and version authority | Repository / source control | Build system | `CHANGELOG.md` is the human release record and root `deno.json` is the package manifest; Nix reads the manifest version. [VERIFIED: CHANGELOG.md:3-19; deno.json:3-5; flake.nix:54-59] |
| Local release verification | Build / release automation | Docker and Nix builders | Deno quality gates, generated assets, no-cache Docker, Nix rebuilds, and publish dry-run establish the candidate before remote review. [VERIFIED: AGENTS.md:19-59,71-73; 04-VERIFICATION-EVIDENCE.md:45-116] |
| Release PR and CI status | GitHub | Local `gh` client | GitHub owns PR/check state; local commands may observe it and submit the human-authorized merge with a head-SHA guard. [CITED: https://cli.github.com/manual/gh_pr_checks; https://cli.github.com/manual/gh_pr_merge] |
| Release identity | Git object database | GitHub tag ref | The tag must peel to the recorded merge commit; a fully qualified one-tag refspec avoids pushing unrelated tags. [CITED: https://git-scm.com/docs/git-tag; https://git-scm.com/docs/git-push; https://git-scm.com/docs/git-rev-parse] |
| Container publication | GitHub Actions / GHCR | Git tag and `master` push events | The existing workflow publishes on `master` pushes and `v*.*.*` tags, deriving SemVer image tags from the Git ref. [VERIFIED: .github/workflows/docker-image.yml:3-8,38-56] |
| Deno package publication | JSR registry | Local Deno CLI | `deno publish` reads `name`, `version`, and `exports` from `deno.json`; JSR versions are immutable snapshots. [CITED: https://docs.deno.com/runtime/reference/cli/publish/; https://jsr.io/docs/packages] |
| Traceability | Phase evidence ledger | GitHub and JSR receipts | Exact SHAs, check URLs, tag resolution, and package-version URLs form a verifiable chain rather than a narrative assertion. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:11-43,118-123] |

## Project Constraints (from AGENTS.md)

- Use the Deno toolchain; there is no `package.json`. The full suite is `deno task test`, lint is `deno lint`, format verification is `deno fmt --check`, and generated assets are built by `deno task build`. [VERIFIED: AGENTS.md:15-59]
- Run `deno fmt` before every commit, then verify with `deno fmt --check`. [VERIFIED: AGENTS.md:61-62]
- Changelog entries stay under `Unreleased`, grouped as Major, Minor, or Patch Changes, until release cut; release cutting moves the accumulated entries into the new version section. [VERIFIED: AGENTS.md:64-66]
- Run `deno task check:nix` after changing Nix inputs. If and only if a reported fixed-output hash is stale, run `deno task update:nix-hashes`, then verify all outputs again. [VERIFIED: AGENTS.md:71-73]
- Release work stays on `v6.4.1`, based on `master`; selected work must not be implemented directly on `master`. [VERIFIED: AGENTS.md:75-80]
- The release PR targets `master`, all required failures must be resolved, and pending or failing required checks block merge. [VERIFIED: AGENTS.md:80-82]
- After merge, update local `master`, verify version/changelog, tag from that state, and publish only from tagged merged `master`, never from the candidate branch. [VERIFIED: AGENTS.md:83-87]
- Preserve the trace chain from each selected contribution through candidate evidence, release PR, tag, and published package. [VERIFIED: AGENTS.md:86-87]
- If unexpected runtime code changes become necessary, all TypeScript, Hono JSX, error-handling, streaming, authentication, worker-pool, storage, and test conventions in AGENTS.md remain mandatory; however, such changes should stop release execution and return to candidate verification because new runtime changes are outside this phase. [VERIFIED: AGENTS.md:166-359; 05-CONTEXT.md:77-81]

## Current Repository and Remote State

The following is a research-time snapshot and must be refreshed by the executor immediately before planning each remote transition. [VERIFIED: read-only Git/gh inspection on 2026-10-06]

- The local branch was `v6.4.1`; local and GitHub branch tips both resolved to `1228305ca713368b56c2d8bede236743270c5af4` at the final snapshot before this research commit. The working tree already contained unrelated planning changes, so release gates must use a later clean, committed preparation head rather than this snapshot. [VERIFIED: `git status`, `git rev-parse`, and `git ls-remote gh` on 2026-10-06]
- The configured remotes are `origin` for the Nostr remote and `gh` for `git@github.com:hzrd149/blossom-server.git`; release-PR inspection and the Docker-publishing tag push therefore need to target GitHub explicitly rather than rely on the current branch's `origin` tracking configuration. [VERIFIED: `git remote -v` and `git config` on 2026-10-06]
- No release PR from `v6.4.1` to `master` existed at research time. The five selected upstream PRs remained open and are evidence inputs, not the release PR itself. [VERIFIED: GitHub GraphQL data via `gh pr list` on 2026-10-06]
- GitHub's branch-protection endpoint reported `master` unprotected, and the repository's only `master` ruleset was disabled. Consequently `gh pr checks --required` can legitimately return no required rows; the release must enforce the repository's release policy and inspect all PR check rows itself. [VERIFIED: GitHub REST branch-protection and rulesets endpoints on 2026-10-06]
- The PR-triggered jobs in-repo are `Deno Tests` and `Flake Check`. The separate `Docker build` workflow runs on non-`master` pushes, not on `pull_request`; final Docker coverage therefore comes from the explicit local release gate plus branch-push workflow evidence, not from the release PR check list. [VERIFIED: .github/workflows/test.yml:3-29; .github/workflows/nix.yml:3-20; .github/workflows/docker-build.yml:3-28]
- The JSR registry reported `@hzrd149/blossom-server` latest as `6.4.0`. A direct request for the `6.4.1` version metadata returned `HTTP 404` with `404 - Not Found`, positively confirming that `6.4.1` had not yet been published at research time. [VERIFIED: JSR registry API probes on 2026-10-06]

## Standard Stack

### Core

| Tool | Verified Version | Purpose | Why Standard Here |
|------|------------------|---------|-------------------|
| Deno | 2.9.5 | Format, lint, check, test, build, and JSR publication | Repository-native toolchain and native `deno publish`. [VERIFIED: `deno --version`; AGENTS.md:15-59] |
| Git | 2.53.0 | Commit identity, ancestry, merge-result verification, and tag creation | Release requirements are SHA- and tag-bound. [VERIFIED: `git --version`; 05-CONTEXT.md:23-35] |
| GitHub CLI | 2.102.0 | Create/read the release PR, inspect checks, and submit the human-approved merge | Installed, authenticated to `github.com`, and supports `--match-head-commit`. [VERIFIED: `gh --version`, `gh auth status`; CITED: https://cli.github.com/manual/gh_pr_merge] |
| Nix | 2.34.7 | Deterministic package/artifact verification | Existing repository script realizes and rebuilds all declared targets. [VERIFIED: `nix --version`; scripts/nix-check.sh:1-21] |
| Docker | 29.8.2 | Fresh local image build before release PR | Mirrors the packaging path without relying on layer cache. [VERIFIED: `docker --version`; 04-VERIFICATION-EVIDENCE.md:91-103] |

### Supporting

| Tool | Verified Version | Purpose | When to Use |
|------|------------------|---------|-------------|
| jq | 1.8.1 | Read JSON manifest and GitHub API output without string parsing | Version assertions and evidence extraction. [VERIFIED: `jq --version` on 2026-10-06] |
| curl | 8.18.0 | Read-only JSR registry verification | Confirm exact package-version metadata after publication. [VERIFIED: `curl --version` on 2026-10-06] |
| GitHub Actions | Repository workflows | PR checks and GHCR publication | PR verification, then automatic image publication on merged `master` and tag pushes. [VERIFIED: .github/workflows/test.yml; .github/workflows/nix.yml; .github/workflows/docker-image.yml] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `deno publish` | `npx jsr publish` | Adds a Node/npm execution path to a Deno-only repository and violates the no-`package.json` convention; use native Deno. [CITED: https://jsr.io/docs/publishing-packages; VERIFIED: AGENTS.md:15-17] |
| Merge commit | Squash merge | Squashing destroys the release branch's traceable commit sequence and is explicitly locked out; use GitHub's merge-commit strategy with a head-SHA guard. [VERIFIED: 05-CONTEXT.md:23-28] |
| Exact tag refspec | `git push --tags` | `--tags` can publish unrelated local tags; push only `refs/tags/v6.4.1`. [CITED: https://git-scm.com/docs/git-push] |
| Repository-convention lightweight tag | Annotated tag | Git generally recommends annotated release tags, but every inspected Blossom release tag—including `v6.4.0`—is lightweight. Preserve the established tag type for this patch and rely on the evidence ledger for release metadata. [CITED: https://git-scm.com/docs/git-tag; VERIFIED: `git cat-file -t refs/tags/*` on 2026-10-06] |

**Installation:** none. This phase installs no external package and must not introduce a release framework. [VERIFIED: 05-CONTEXT.md:77-81]

## Package Legitimacy Audit

Not applicable. The phase installs no npm, JSR, PyPI, or crates package; all required tools are already installed and repository-native. [VERIFIED: environment audit on 2026-10-06]

## Architecture Patterns

### System Architecture Diagram

```text
v6.4.1 candidate + Phase 4 evidence
                 |
                 v
release-preparation commit
(dated notes + deno.json 6.4.1 + checklist + seeded evidence)
                 |
                 v
full local release gates ---- fail ----> fix on v6.4.1, invalidate old evidence, rerun
                 |
               pass
                 v
push candidate + open v6.4.1 -> master PR
                 |
                 v
record reviewed head SHA + all PR checks ---- pending/fail/non-success ----> wait/fix/rerun
                 |
             all success
                 v
[HUMAN CHECKPOINT 1: merge PR]
                 |
                 v
merged master SHA -> update local master -> prove clean/version/ancestry
                 |
                 v
create local v6.4.1 tag at exact merge SHA -> peel/compare
                 |
                 v
[HUMAN CHECKPOINT 2: push exact tag] ---> GitHub tag workflow ---> GHCR SemVer images
                 |
                 v
clean tagged merged-master checkout + publish dry run
                 |
                 v
[HUMAN CHECKPOINT 3: deno publish] ---> JSR immutable @hzrd149/blossom-server@6.4.1
                 |
                 v
verify registry metadata + append final receipts without moving the tag
```

The diagram is a state machine: transitions occur only when the prior state's evidence is bound to the exact current SHA. [VERIFIED: 05-CONTEXT.md:23-35; 04-VERIFICATION-EVIDENCE.md:11-23]

### Recommended Project Structure

Use two release documents in the existing Phase 5 directory: a reusable checklist containing commands/invariants and an evidence ledger containing only this release's identities and outcomes. The exact filenames are at the planner's discretion. [VERIFIED: 05-CONTEXT.md:18-21,37-39]

```text
.planning/phases/05-v6-4-1-release/
├── 05-RESEARCH.md             # planning research
├── 05-RELEASE-CHECKLIST.md    # reusable procedure and three human gates
└── 05-RELEASE-EVIDENCE.md     # immutable inputs plus append-only execution receipts
```

### Pattern 1: One Authoritative Version, Multiple Derived Assertions

**What:** change only the root manifest's version and verify all derived consumers. The current authoritative tuple is quoted verbatim below. [VERIFIED: deno.json:3-5]

```text
REPO_A7K2M9QX_START
"name": "@hzrd149/blossom-server",
"version": "6.4.0",
"exports": "./main.ts"
REPO_A7K2M9QX_END
```

`flake.nix` reads `.version` from that same file and passes it to the Nix package set; therefore `nix eval` is a derived-version assertion, not another edit site. [VERIFIED: flake.nix:54-59]

**When to use:** preparation, post-merge verification, and immediately before publication.

**Prescriptive checks:** assert `.version == "6.4.1"`; assert `v${version} == v6.4.1`; assert default and client-bundle Nix versions are `6.4.1`; require the publish dry run to identify `@hzrd149/blossom-server@6.4.1`. Do not replace the historical `6.4.0` changelog heading. [VERIFIED: CHANGELOG.md:19-44; CITED: https://docs.deno.com/runtime/reference/cli/publish/]

### Pattern 2: SHA-Bound Gate Receipts

**What:** every gate row records command, start/end timestamp, exit status, tested SHA, and relevant output/digest. A later commit invalidates the row unless the changed files are explicitly shown not to affect the gate; for release preparation, prefer a full clean rerun so the release PR head has one coherent evidence set. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:11-23,118-123]

**When to use:** all local gates, PR checks, merge verification, tag verification, and publication.

**Required evidence columns:** stage, source SHA, command/API, expected invariant, observed result, timestamp, receipt URL/digest, and disposition. Seed the contribution rows with the exact five integration SHAs already recorded by Phase 4; do not rerender them from abbreviated commit names. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:35-43]

### Pattern 3: Policy-Enforced PR Checks

**What:** fetch the PR's current `headRefOid`, base branch, mergeability, and complete `statusCheckRollup`; record every check's name, workflow, conclusion/state, URL, and completion time. Re-fetch immediately before the merge checkpoint and reject any head-SHA change. [CITED: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks; https://cli.github.com/manual/gh_pr_checks]

**When to use:** after opening the release PR and immediately before merge.

**Repository-specific rule:** because active GitHub protection currently requires zero checks, treat the PR-triggered `Deno Tests` and `Flake Check` jobs—and any additional check that appears on the release PR—as release-mandated. Require literal successful completion; do not accept pending, failure, cancellation, action-required, skipped, or neutral as satisfying this release's locked policy even if GitHub's generic branch-protection semantics would allow some non-failing states. [VERIFIED: .github/workflows/test.yml:1-29; .github/workflows/nix.yml:1-20; GitHub REST protection snapshot on 2026-10-06]

### Pattern 4: Three Non-Delegable Human Gates

**What:** each checkpoint presents the exact object identity, consequence, and single command that will execute, then waits for an explicit human answer in that moment. Prior approval, auto-advance mode, or a general instruction to finish the release is not approval for any of these three actions. [VERIFIED: 05-CONTEXT.md:30-35]

| Gate | Evidence shown before asking | Consequence disclosed |
|------|------------------------------|-----------------------|
| Merge PR | PR URL/number, reviewed head SHA, complete successful check table, merge strategy | Mutates `master` and triggers the `master` Docker image publication workflow. [VERIFIED: .github/workflows/docker-image.yml:3-6,50-56] |
| Push tag | Merge commit, local `master` SHA, peeled tag SHA, remote nonexistence check | Creates public release ref and triggers SemVer GHCR image publication. [VERIFIED: .github/workflows/docker-image.yml:7-8,38-56] |
| Publish Deno package | Clean tree, branch/tag/SHA equality, version tuple, successful dry-run summary | Creates immutable JSR version `6.4.1`; local CLI may open browser authentication. [CITED: https://jsr.io/docs/packages; https://jsr.io/docs/publishing-packages] |

### Pattern 5: Precommitted Procedure, Post-Action Receipts

**What:** commit the checklist and evidence schema before opening the release PR, with remote-result fields visibly marked pending. After merge/tag/publication, backfill actual receipts in a documentation-only follow-up without moving or recreating `v6.4.1`. [VERIFIED: 05-CONTEXT.md:18-28,32-35]

**When to use:** facts that cannot exist before their action, such as merge commit, remote tag ref, and JSR publication URL.

**Reason:** inventing future values is false evidence, while tagging a later evidence commit violates the locked requirement. The follow-up record may be a descendant of the release tag; the tag itself remains fixed to the release-PR merge commit. [VERIFIED: 05-CONTEXT.md:28-35]

### Pattern 6: Clean Worktree Isolation

**What:** create a temporary detached worktree at the exact preparation SHA for the local release gates, and a separate clean `master` worktree after the release PR merges for tag/publication assertions. Do not clean, stash, reset, or delete unrelated files from the shared checkout. [VERIFIED: read-only worktree audit on 2026-10-06]

**When to use:** whenever the main checkout contains user-owned changes or untracked planning artifacts, as it did during research.

**Invariant:** the detached gate worktree's `HEAD` must equal `refs/heads/v6.4.1` at gate start, and the post-merge worktree's `HEAD` must equal both the GitHub merge commit and `refs/heads/master`. The evidence records those full SHAs and the worktree's empty porcelain status. [VERIFIED: 05-CONTEXT.md:23-35]

### Anti-Patterns to Avoid

- **Broad `6.4.0` replacement:** it would corrupt historical changelog entries; edit `deno.json` deliberately and verify downstream values. [VERIFIED: CHANGELOG.md:19-44; deno.json:3-5]
- **Using Phase 4 results as the final release-head results:** Phase 4 is bound to source candidate `331dabdd4189d3a90226650387341fb8aeae3ea6`; the version/changelog preparation commit changes package inputs and needs its own release-head evidence. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:1-23]
- **Treating an empty `gh pr checks --required` result as green:** current GitHub enforcement is disabled. Inspect all PR checks and enforce the repository policy explicitly. [VERIFIED: GitHub REST protection snapshot on 2026-10-06]
- **Merging with `--admin`, `--auto`, or without a head guard:** these bypass or defer the required moment-of-action human decision and can merge an unreviewed head. [CITED: https://cli.github.com/manual/gh_pr_merge]
- **Tagging the release branch:** update and verify local `master`, then target the recorded merge SHA explicitly. [VERIFIED: AGENTS.md:83-85]
- **Pushing all tags:** push only the fully qualified `v6.4.1` ref. [CITED: https://git-scm.com/docs/git-push]
- **Publishing with `--allow-dirty` or `--set-version`:** dirty publication breaks source identity, and an override makes the published version diverge from authoritative metadata. [CITED: https://docs.deno.com/runtime/reference/cli/publish/]
- **Recording secrets or browser-auth codes:** retain only public package URLs and command outcome; never paste tokens, device codes, cookies, or credential output into evidence. [CITED: https://jsr.io/docs/api]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Semantic package validation | Custom archive/version checker | `deno publish --dry-run --check=all` | Runs the same package validations without upload and shows the publish set. [CITED: https://docs.deno.com/runtime/reference/cli/publish/] |
| JSON manifest parsing | `grep`/`sed` version extraction | `jq` or `deno eval` JSON parsing | Avoids matching lockfile versions or historical notes. [VERIFIED: deno.json:1-65; deno.lock:1-14] |
| Required-check polling | Ad hoc REST loops | `gh pr checks` plus `gh pr view --json statusCheckRollup` | Exposes check state/URLs and supports watching while preserving complete evidence. [CITED: https://cli.github.com/manual/gh_pr_checks] |
| Merge race protection | Manual visual comparison only | `gh pr merge --merge --match-head-commit <SHA>` after human confirmation | Refuses a merge if the PR head moved after review. [CITED: https://cli.github.com/manual/gh_pr_merge] |
| Version propagation into Nix | Duplicate version constants | Existing `flake.nix` read of `deno.json` | Keeps one authority and makes derived output testable. [VERIFIED: flake.nix:54-59] |
| Fixed-output hash guessing | Manually edited hashes | `deno task check:nix`, then `deno task update:nix-hashes` only on mismatch | Repository scripts rebuild declared outputs and refresh measured hashes. [VERIFIED: AGENTS.md:71-73; scripts/nix-check.sh:5-21] |
| Release traceability | Prose-only completion note | Structured evidence ledger with immutable SHAs and receipt URLs | Prevents results from different candidate states being combined. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:118-123] |

**Key insight:** release engineering is primarily identity and transition control. Existing Deno, Git, GitHub, Docker, Nix, and JSR primitives already solve validation, checks, tagging, and publication; the plan should compose them and record receipts rather than add release code. [VERIFIED: repository and environment audit on 2026-10-06]

## Common Pitfalls

### Pitfall 1: Release Date Becomes False While CI Runs

**What goes wrong:** the changelog is dated when the PR opens, but merge/tag/publication happen on a later day.  
**Why it happens:** the locked wording requires the actual release day, while PR checks are asynchronous. [VERIFIED: 05-CONTEXT.md:16-18,23-28]  
**How to avoid:** schedule preparation and release deliberately. If the date changes before merge, update the changelog on `v6.4.1`, push the new head, discard the old reviewed-head evidence, and wait for every check again.  
**Warning signs:** current date differs from the release heading, or the PR head SHA differs from the recorded reviewed SHA.

### Pitfall 2: GitHub UI Allows Merge Without Enforcing This Release's Policy

**What goes wrong:** a maintainer sees an enabled merge button even though checks are pending or absent.  
**Why it happens:** `master` had no active protection and its ruleset was disabled at research time. [VERIFIED: GitHub REST protection snapshot on 2026-10-06]  
**How to avoid:** make the evidence table and checkpoint predicate authoritative: expected PR workflows present, every check successful, reviewed head unchanged, no conflicts, and no unresolved failures.  
**Warning signs:** `gh pr checks --required` prints no rows, `mergeStateStatus` is not clean, or `statusCheckRollup` is empty.

### Pitfall 3: Phase 4 Evidence Is Reused Across a Changed Package

**What goes wrong:** final release claims are based on SHA `331dabd...`, but `deno.json` and `CHANGELOG.md` have since changed.  
**Why it happens:** the earlier ledger correctly bound itself to the source candidate and explicitly excluded later input changes. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:11-23,118-123]  
**How to avoid:** cite Phase 4 for regression history, then run a new coherent release gate on the preparation head.  
**Warning signs:** release evidence has no final-preparation SHA or mixes old artifact hashes with a new manifest version.

### Pitfall 4: Nix Output Still Says 6.4.0

**What goes wrong:** the manifest is bumped but derived Nix outputs or cached derivations retain the previous version.  
**Why it happens:** old store paths or a stale fixed-output hash can mask incomplete regeneration. [VERIFIED: AGENTS.md:71-73; 04-VERIFICATION-EVIDENCE.md:105-116]  
**How to avoid:** evaluate the derived version first, run the force-rebuild script, update hashes only if Nix diagnoses a mismatch, and then rerun the complete Nix gate.  
**Warning signs:** evaluated derivation names contain `6.4.0`, the hash-update script changed files without a preceding mismatch, or only a cached build was inspected.

### Pitfall 5: Tag Points to the Wrong Object

**What goes wrong:** `v6.4.1` points to the candidate head, a later evidence commit, or an outdated local `master`.  
**Why it happens:** tag creation defaults to current `HEAD` if no explicit commit is supplied. [CITED: https://git-scm.com/docs/git-tag]  
**How to avoid:** fetch GitHub `master`, fast-forward local `master`, compare it with the PR merge commit, create the tag with that full SHA as an explicit argument, and verify `v6.4.1^{commit}` before asking to push.  
**Warning signs:** tag creation command omits the commit argument or any of the three SHAs differ.

### Pitfall 6: Tag Push Has an Undisclosed Publication Side Effect

**What goes wrong:** pushing a tag unexpectedly publishes `6.4.1`, `6.4`, and `6` container tags.  
**Why it happens:** `docker-image.yml` listens to `v*.*.*` and uses Docker metadata SemVer patterns. [VERIFIED: .github/workflows/docker-image.yml:3-8,38-56]  
**How to avoid:** disclose the GHCR workflow in the tag-push checkpoint and record its run URL/outcome in release evidence.  
**Warning signs:** checkpoint text describes tag creation only and omits container publication.

### Pitfall 7: Published Package Does Not Match the Tag

**What goes wrong:** `deno publish` runs from a dirty tree, candidate branch, or post-tag evidence commit.  
**Why it happens:** local interactive publication uses the current filesystem, not the remote tag by magic. [CITED: https://jsr.io/docs/publishing-packages]  
**How to avoid:** immediately before the publication checkpoint assert clean status, branch `master`, `HEAD == merge SHA`, `HEAD == v6.4.1^{commit}`, version `6.4.1`, and a fresh successful dry run. Do not pass `--allow-dirty`.  
**Warning signs:** untracked release files, detached unexpected commit, version override flag, or dry-run output from an earlier SHA.

### Pitfall 8: Future Outcomes Are Prewritten as Evidence

**What goes wrong:** a committed ledger contains guessed PR numbers, merge SHAs, check results, tag push status, or package URLs.  
**Why it happens:** the checklist and evidence are required before the release PR, but those outcomes do not exist yet.  
**How to avoid:** commit schema and known inputs first, mark future receipt fields pending, then append actual values after each transition.  
**Warning signs:** a SHA or URL cannot be reproduced with a read-only command at the time it is recorded.

### Pitfall 9: Making the Shared Checkout Clean by Destroying User State

**What goes wrong:** release preparation deletes, resets, or stashes unrelated work merely to satisfy a clean-tree assertion.  
**Why it happens:** the shared checkout had unrelated tracked and untracked planning state at research time. [VERIFIED: `git status --short` on 2026-10-06]  
**How to avoid:** use a new clean Git worktree at the exact release SHA and leave the shared checkout untouched.  
**Warning signs:** any plan task proposes `git reset --hard`, `git clean`, broad deletion, or an unexplained stash.

## Code Examples

These are command patterns for the checklist. Commands marked **HUMAN CHECKPOINT** are examples for the planner to place behind an explicit user-confirmation task; they must never be executed automatically. [VERIFIED: 05-CONTEXT.md:30-35]

### Manifest and Derived-Version Gate

```bash
release_version=$(jq -r '.version' deno.json)
test "$release_version" = "6.4.1"
test "v$release_version" = "v6.4.1"
test "$(nix eval --raw --no-write-lock-file .#packages.x86_64-linux.default.version)" = "$release_version"
test "$(nix eval --raw --no-write-lock-file .#packages.x86_64-linux.clientBundle.version)" = "$release_version"
deno check --frozen main.ts
deno publish --dry-run --check=all
```

The installed Deno 2.9.5 help exposes `--dry-run` and `--check=all`, but not the current online docs' `--frozen-lockfile` publish option. Keep lock enforcement as the separate `deno check --frozen main.ts` gate instead of planning an unsupported flag. [VERIFIED: installed `deno publish --help=full` on 2026-10-06; CITED: https://docs.deno.com/runtime/reference/cli/publish/]

### Local Release Gate Order

```bash
release_head=$(git rev-parse HEAD)
test "$release_head" = "$(git rev-parse refs/heads/v6.4.1)"
test -z "$(git status --porcelain --untracked-files=all)"

deno fmt --check
deno lint
deno check --frozen main.ts
deno task test
deno task build
docker build --pull --no-cache --progress=plain -t "blossom-server:v6.4.1-rc-${release_head}" .
deno task check:nix
deno publish --dry-run --check=all

test "$(git rev-parse HEAD)" = "$release_head"
test -z "$(git status --porcelain --untracked-files=all)"
```

The final checklist should retain Phase 4's stronger generated-asset procedure—rebuild twice from bounded deletion, require non-empty outputs, and compare SHA-256 hashes—rather than treating one successful `deno task build` as deterministic evidence. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:80-89]

### Read-Only PR Review and Check Capture

```bash
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
pr_number="<release-pr-number>"

gh pr view "$pr_number" --repo "$repo" \
  --json number,url,headRefName,headRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,statusCheckRollup
gh pr checks "$pr_number" --repo "$repo" --watch

reviewed_head=$(gh pr view "$pr_number" --repo "$repo" --json headRefOid -q .headRefOid)
test -n "$reviewed_head"
```

After the watch exits, capture and inspect the complete JSON again. The plan must explicitly fail if any row is not successful or if expected PR workflows are absent. [CITED: https://cli.github.com/manual/gh_pr_checks]

### Human-Authorized Merge

```bash
# HUMAN CHECKPOINT 1 — only after the user confirms the displayed PR/check/head evidence.
gh pr merge "$pr_number" --repo "$repo" --merge --match-head-commit "$reviewed_head"
```

Do not use `--admin`, `--auto`, `--squash`, or an unguarded merge invocation. [CITED: https://cli.github.com/manual/gh_pr_merge; VERIFIED: 05-CONTEXT.md:23-35]

### Post-Merge and Exact Tag Gate

```bash
merge_sha=$(gh pr view "$pr_number" --repo "$repo" --json mergeCommit -q .mergeCommit.oid)
git fetch gh master
git switch master
git merge --ff-only gh/master
test "$(git rev-parse HEAD)" = "$merge_sha"
test -z "$(git status --porcelain --untracked-files=all)"
test "$(jq -r '.version' deno.json)" = "6.4.1"

git tag v6.4.1 "$merge_sha"
test "$(git rev-parse 'v6.4.1^{commit}')" = "$merge_sha"

# HUMAN CHECKPOINT 2 — only after the user confirms the tag target and GHCR side effect.
git push gh refs/tags/v6.4.1:refs/tags/v6.4.1
```

The repository convention is a lightweight release tag; the explicit commit argument and peeled-commit comparison make its target unambiguous. [VERIFIED: all inspected local release refs are commit objects; CITED: https://git-scm.com/docs/git-tag]

### Clean Tagged Publication Gate

```bash
test "$(git branch --show-current)" = "master"
test "$(git rev-parse HEAD)" = "$merge_sha"
test "$(git rev-parse 'v6.4.1^{commit}')" = "$merge_sha"
test -z "$(git status --porcelain --untracked-files=all)"
test "$(jq -r '.version' deno.json)" = "6.4.1"
deno publish --dry-run --check=all

# HUMAN CHECKPOINT 3 — only after the user confirms the exact source state and dry-run result.
deno publish --check=all

curl -fsSL -H 'Accept: application/json' \
  'https://jsr.io/@hzrd149/blossom-server/6.4.1_meta.json' >/dev/null
```

Interactive local publication can open a browser approval flow. The evidence record must capture only the success result and public package URL, never the authentication code or token. [CITED: https://jsr.io/docs/publishing-packages]

## State of the Art

| Old / Generic Approach | Current / Repository Approach | When Relevant | Impact |
|------------------------|-------------------------------|---------------|--------|
| Separate `jsr` CLI through npm | Native `deno publish` | Deno 2 repository | Avoids a second package-manager path and reads the existing `deno.json`. [CITED: https://docs.deno.com/runtime/reference/cli/publish/] |
| Trusting the merge button | Check latest SHA and merge with `--match-head-commit` | Release PR | Prevents a reviewed-head race even when branch protection is absent. [CITED: https://cli.github.com/manual/gh_pr_merge] |
| Narrative release notes from commit logs | Curated `Unreleased` entries moved into an ISO-dated release | Every release | Preserves operator relevance and contributor attribution. [CITED: https://keepachangelog.com/en/1.1.0/; VERIFIED: CHANGELOG.md:3-17] |
| Token-based CI publication | GitHub OIDC publication with provenance | Possible future workflow improvement | JSR supports provenance from linked GitHub Actions, but adding a publish workflow is a release-process redesign and remains out of scope for v6.4.1. [CITED: https://jsr.io/docs/publishing-packages; VERIFIED: 05-CONTEXT.md:77-81] |

**Deprecated/outdated for this phase:**

- `npx jsr publish`: supported by JSR but not appropriate for this Deno-only repository. [CITED: https://jsr.io/docs/publishing-packages; VERIFIED: AGENTS.md:15-17]
- `git push --tags`: valid Git, but too broad for a single controlled release tag. [CITED: https://git-scm.com/docs/git-push]
- `gh pr merge --admin`: a bypass mechanism and contrary to the no-exception CI decision. [CITED: https://cli.github.com/manual/gh_pr_merge; VERIFIED: 05-CONTEXT.md:23-28]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | [ASSUMED] The human who performs the third checkpoint has JSR scope permission and local interactive publication is allowed for `@hzrd149/blossom-server`. | Environment / Open Questions | Live publication could be rejected after all other release steps; confirm at the checkpoint without exposing credentials. |
| A2 | [ASSUMED] A documentation-only follow-up change is an acceptable place to persist post-merge/tag/publication receipts. | Architecture Pattern 5 | If maintainers require every receipt inside the tagged tree, the requirements conflict because those outcomes do not exist before the tag; resolve before execution. |

## Open Questions

1. **Is local JSR publication permitted for the scope?**
   - What we know: Deno 2.9.5 supports interactive `deno publish`; the package exists and `6.4.0` is current. [VERIFIED: environment and JSR registry probes on 2026-10-06]
   - What's unclear: JSR scope settings and the maintainer's package permission are not public through the registry API. [ASSUMED]
   - Recommendation: keep the third human checkpoint interactive. If JSR reports CI-only publication, stop and request direction; do not add a new publish workflow during the release without explicit approval because process redesign is deferred. [VERIFIED: 05-CONTEXT.md:77-81]

2. **Where should final post-publication receipts be committed?**
   - What we know: checklist/schema must precede the release PR, while merge/tag/publication receipts can only be known afterward; the tag may not move to a later documentation commit. [VERIFIED: 05-CONTEXT.md:18-35]
   - What's unclear: CONTEXT.md leaves evidence-table structure to planning and does not specify the follow-up branch/PR. [VERIFIED: 05-CONTEXT.md:37-39]
   - Recommendation: plan a documentation-only follow-up change after publication, preserve `v6.4.1` at the original release merge, and use the repository's normal branch/PR policy rather than committing directly to `master`. [VERIFIED: AGENTS.md:75-87]

## Environment Availability

| Dependency | Required By | Available | Version / State | Fallback |
|------------|-------------|-----------|-----------------|----------|
| Deno | Quality gates and JSR publication | ✓ | 2.9.5 | None needed. [VERIFIED: `deno --version`] |
| Git | SHA/tag operations | ✓ | 2.53.0 | None needed. [VERIFIED: `git --version`] |
| GitHub CLI | PR/check/merge operations | ✓ | 2.102.0, authenticated with repository access | GitHub web UI only with equivalent evidence; CLI is preferred. [VERIFIED: `gh --version`; `gh auth status`] |
| Docker | Fresh image gate | ✓ | 29.8.2 | Phase 4 evidence is historical only; no fallback for the final release-head gate. [VERIFIED: `docker --version`] |
| Nix | Deterministic package gate | ✓ | 2.34.7 | No fallback; this is a locked release-quality gate. [VERIFIED: `nix --version`; AGENTS.md:71-73] |
| jq | JSON assertions | ✓ | 1.8.1 | `deno eval` JSON parsing. [VERIFIED: `jq --version`] |
| curl | JSR metadata verification | ✓ | 8.18.0 | Browser/JSR page, but retain exact version URL. [VERIFIED: `curl --version`] |
| JSR publication authorization | Live publication | Unconfirmed | Browser/device authorization or scope policy not probed | Explicit human checkpoint; stop on authorization failure. [ASSUMED] |

**Missing dependencies with no fallback:** none detected locally. JSR authorization is an unconfirmed external permission, not an installable dependency. [VERIFIED: environment audit on 2026-10-06]

**Missing dependencies with fallback:** none. [VERIFIED: environment audit on 2026-10-06]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Deno 2.9.5 built-in test runner [VERIFIED: deno.json:12-25] |
| Config file | Root `deno.json`; client test uses its isolated config/lock [VERIFIED: deno.json:12-21] |
| Quick run command | `deno fmt --check && deno lint && deno check --frozen main.ts` [VERIFIED: AGENTS.md:35-42; 04-VERIFICATION-EVIDENCE.md:45-59] |
| Full suite command | `deno task test` [VERIFIED: deno.json:15-16; AGENTS.md:26-27] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RELS-01 | All six Unreleased patch entries move together into dated `6.4.1`, preserving PR/contributor links | structural/document | Checklist assertion over `CHANGELOG.md` plus `git diff --check` | ❌ checklist assertion created in release docs |
| RELS-02 | Manifest and derived Nix outputs report `6.4.1` | configuration/integration | `jq` manifest assertions; `nix eval`; `deno task check:nix` | ✅ existing Nix scripts; assertion documented in Wave 0 |
| RELS-03 | Final preparation SHA passes all release artifact gates | integration/build | Deno gates, double asset build/hash, no-cache Docker, Nix force rebuild, Deno publish dry-run | ✅ commands exist; ledger created in Wave 0 |
| RELS-04 | Five PRs trace through immutable SHAs, tests, notes, and release receipts | structural/audit | `git merge-base --is-ancestor` for each Phase 4 SHA plus ledger completeness checks | ✅ source ledgers exist; final ledger created in Wave 0 |
| RELS-05 | Release PR head has complete successful checks before merge | remote integration/manual gate | `gh pr view --json ...statusCheckRollup`; `gh pr checks --watch`; human checkpoint | Manual-only merge; read-only verification automated |
| RELS-06 | Tag and package originate from exact merged `master` SHA | integration/manual gate | Git SHA equality checks, exact tag ref readback, JSR version metadata HTTP 200; two human checkpoints | Manual-only tag push and publish; assertions automated |

### Sampling Rate

- **Per preparation commit:** run the quick command, manifest assertions, and `git diff --check`. [VERIFIED: AGENTS.md:61-62]
- **Before opening the release PR:** run the complete local release gate once on the exact clean preparation SHA and seal its evidence. [VERIFIED: 05-CONTEXT.md:23-28]
- **Before merge:** re-read PR head and complete checks; any head change invalidates the prior review. [CITED: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks]
- **Before tag push and publication:** rerun the cheap SHA/version/cleanliness assertions immediately before each checkpoint; rerun publish dry-run immediately before live publish. [CITED: https://docs.deno.com/runtime/reference/cli/publish/]
- **Phase gate:** evidence ledger contains actual receipts for preparation head, PR, checks, merge, tag, GHCR workflow, and JSR `6.4.1`, with no pending field. [VERIFIED: 05-CONTEXT.md:18-35]

### Wave 0 Gaps

- [ ] Release checklist document—exact commands, expected outcomes, invalidation rules, and three human checkpoints. [VERIFIED: 05-CONTEXT.md:18-21,37-39]
- [ ] Release evidence ledger—seed Phase 1/4 identities and leave future remote receipt fields explicitly pending. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:25-43; 05-CONTEXT.md:18-21]
- [ ] Structural changelog/version assertions embedded in the checklist; no new application test framework or test file is needed. [VERIFIED: this phase changes release metadata/process only; 05-CONTEXT.md:6-10]

## Security Domain

This phase changes release metadata and distribution state, not runtime request handling. The relevant security boundary is software-supply-chain integrity: ensure the reviewed source, merged commit, public tag, container build trigger, and immutable JSR version all identify the same release. [VERIFIED: 05-CONTEXT.md:23-35; CITED: https://jsr.io/docs/trust]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No new runtime behavior | Preserve Phase 4's tested BUD-11 behavior; release tasks must not modify auth code. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:35-41,56-67] |
| V3 Session Management | No | No session-management change in release metadata. [VERIFIED: 05-CONTEXT.md:6-10] |
| V4 Access Control | No new runtime behavior | Preserve Phase 4 authorization regressions; use authenticated GitHub/JSR accounts only at human gates. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:35-41] |
| V5 Input Validation | No new runtime behavior | Release notes/version changes must not alter the already verified route/input boundaries. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:35-67] |
| V6 Cryptography | No new application cryptography | Use Git object identities, SHA-256 artifact digests, and registry/TLS tooling; never invent custom signing or hashing. [VERIFIED: 04-VERIFICATION-EVIDENCE.md:80-103] |

### Known Threat Patterns for Release Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PR head changes after review | Tampering | Re-read `headRefOid`, invalidate old evidence, merge with `--match-head-commit`. [CITED: https://cli.github.com/manual/gh_pr_merge] |
| Stale/absent checks treated as success | Tampering / Repudiation | Require expected workflows plus every observed check to complete successfully on the latest relevant SHA. [CITED: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks] |
| Tag targets candidate or later docs commit | Spoofing / Repudiation | Create tag with explicit merge SHA and verify peeled commit before/after push. [CITED: https://git-scm.com/docs/git-tag; https://git-scm.com/docs/git-rev-parse] |
| Dirty local publication | Tampering | Clean-tree assertion, exact tag/HEAD equality, no `--allow-dirty`, and dry run immediately before publication. [CITED: https://docs.deno.com/runtime/reference/cli/publish/] |
| Credential/device-code leakage in evidence | Information Disclosure | Use interactive auth and record only public receipt URLs/outcomes. [CITED: https://jsr.io/docs/publishing-packages] |
| Unintended bulk tag publication | Elevation / Tampering | Push one fully qualified tag ref; never use `--tags` or force. [CITED: https://git-scm.com/docs/git-push] |
| Unexpected GHCR publication from tag | Repudiation | Disclose workflow side effect at checkpoint and retain Actions run URL and image tags/digests. [VERIFIED: .github/workflows/docker-image.yml:3-8,38-56] |

## Sources

### Primary (HIGH confidence)

- `deno.json:1-65`—package identity/version/exports and Deno tasks.
- `flake.nix:54-59` and `nix/package.nix:1-65`—version derivation and Nix outputs.
- `.github/workflows/test.yml`, `.github/workflows/nix.yml`, `.github/workflows/docker-build.yml`, `.github/workflows/docker-image.yml`—actual trigger and job definitions.
- `CHANGELOG.md:3-19`—the complete current release-note source.
- `AGENTS.md:15-87`—quality gates, changelog rules, and release workflow.
- `.planning/phases/04-integrated-candidate-verification/04-VERIFICATION-EVIDENCE.md`—candidate SHA, five contribution SHAs, regression gates, and artifact evidence.
- Git/GitHub/JSR read-only probes on 2026-10-06—current refs, protection/ruleset state, PR state, installed tools, and registry metadata.

### Secondary (MEDIUM confidence)

- https://docs.deno.com/runtime/reference/cli/publish/—native publication requirements and dry-run/check/auth options.
- https://jsr.io/docs/publishing-packages—dry-run, local interactive publishing, CI OIDC, and public receipt behavior.
- https://jsr.io/docs/packages—SemVer and immutable version behavior.
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks—latest-SHA check semantics.
- https://cli.github.com/manual/gh_pr_checks—check inspection/watch behavior.
- https://cli.github.com/manual/gh_pr_merge—merge strategies and head-SHA guard.
- https://git-scm.com/docs/git-tag, https://git-scm.com/docs/git-push, https://git-scm.com/docs/git-rev-parse—tag types, exact refspecs, and peeled commit verification.
- https://keepachangelog.com/en/1.1.0/—Unreleased-to-dated-release convention.

### Tertiary (LOW confidence)

- None. Unverified operational permissions are isolated in the Assumptions Log.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH—installed tools and repository commands were directly inspected; no new package is proposed.
- Architecture: HIGH—release transitions follow locked CONTEXT.md decisions and actual repository workflows/remotes.
- Pitfalls: HIGH—most are direct consequences of current branch protection, workflow triggers, prior SHA-bound evidence, and official CLI semantics.
- JSR authorization: LOW—scope settings and human permission require confirmation at the publication checkpoint.

**Research date:** 2026-10-06  
**Valid until:** 2026-10-13 for live GitHub/JSR state; repository-source findings remain valid until those files change.
