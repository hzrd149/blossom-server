# Phase 5: v6.4.1 Release - Pattern Map

**Mapped:** 2026-10-06
**Files analyzed:** 5 release files (4 required, 1 conditional)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Tracked Analog | Match Quality |
|---|---|---|---|---|
| `CHANGELOG.md` | release documentation | transform | `CHANGELOG.md` release sections | exact |
| `deno.json` | package config | transform | `deno.json` package tuple plus `flake.nix` consumer | exact |
| `.planning/phases/05-v6-4-1-release/05-RELEASE-CHECKLIST.md` | release procedure | batch / human-gated event flow | `.planning/phases/04-integrated-candidate-verification/04-02-PLAN.md` | role-match |
| `.planning/phases/05-v6-4-1-release/05-RELEASE-EVIDENCE.md` | evidence ledger | event-driven / append-only | `.planning/phases/04-integrated-candidate-verification/04-VERIFICATION-EVIDENCE.md` | exact |
| `nix/package.nix` (conditional only) | build config | transform | `scripts/nix-update-hashes.sh` invoked by the established Phase 4 gate | role-match |

All named analogs are Git-tracked. No `.gsd` capability mirror or ignored runtime path is used as an analog.

## Pattern Assignments

### `CHANGELOG.md` (release documentation, transform)

**Analog:** `CHANGELOG.md`

**Release-section pattern** (lines 3-28):

```markdown
## Unreleased

### Patch Changes

- Operator-facing change; contributed by
  [@contributor](https://github.com/contributor) in [#NN](https://github.com/hzrd149/blossom-server/pull/NN).

## 6.4.0

### Minor Changes
```

For v6.4.1, retain an empty `## Unreleased` section, then insert `## 6.4.1 - YYYY-MM-DD` using the actual release day and move all six current patch bullets together. Preserve the existing attribution/link spelling for PRs #53, #54, #62, #63, and #64. Do not edit the historical `6.4.0` heading or selectively leave current entries behind.

**Validation pattern:** compare the before/after bullet set structurally, require six entries under `6.4.1`, require all five PR URLs and contributor credits, and require no patch bullet to remain under `Unreleased`.

---

### `deno.json` (package config, transform)

**Analog:** `deno.json`; derived consumer: `flake.nix`

**Authoritative package tuple** (`deno.json`, lines 1-5):

```json
{
  "$schema": "https://raw.githubusercontent.com/denoland/deno/refs/heads/main/cli/schemas/config-file.v1.json",
  "name": "@hzrd149/blossom-server",
  "version": "6.4.0",
  "exports": "./main.ts"
}
```

Change only the tuple's `version` value to `6.4.1`. Do not broadly replace `6.4.0`; the old changelog heading is historical evidence.

**Derived-version pattern** (`flake.nix`, lines 54-59):

```nix
packages = forAllSystems (
  system: pkgs:
  (import ./nix/package.nix {
    inherit pkgs src;
    version = (builtins.fromJSON (builtins.readFile ./deno.json)).version;
  })
```

Treat Nix versions and `deno publish --dry-run --check=local` output as assertions, not extra version edit sites. Assert manifest `6.4.1`, tag string `v6.4.1`, default/client-bundle Nix output `6.4.1`, and package identity `@hzrd149/blossom-server@6.4.1`.

---

### `.planning/phases/05-v6-4-1-release/05-RELEASE-CHECKLIST.md` (release procedure, batch / human-gated event flow)

**Analog:** `.planning/phases/04-integrated-candidate-verification/04-02-PLAN.md`

**Immutable-input and invalidation pattern** (lines 20-27, 150-162):

```markdown
- One recorded source candidate SHA passes all gates.
- Any source/hash repair restarts the complete evidence run.
- Do not suppress a failed gate or combine outcomes from different source candidate states.
```

Copy the Phase 4 ordering discipline: capture a full SHA and clean relevant inputs before gates; run the whole chain; assert HEAD/status again afterward; invalidate all prior results if preparation changes. Use a clean detached worktree rather than resetting, cleaning, or stashing the shared checkout.

**Local gate pattern** (`04-VERIFICATION-EVIDENCE.md`, lines 45-59, 80-116):

```sh
deno check --frozen main.ts
deno fmt --check
deno lint
deno task test
# Then deterministic two-build assets, fresh Docker, Nix rebuild, publish dry-run.
```

The checklist should spell out exact commands and expected invariants for: manifest/changelog structure, frozen check, format, lint, full tests, two fresh asset builds with matching non-empty SHA-256 digests, `docker build --pull --no-cache`, `deno task check:nix`, and `deno publish --dry-run --check=local`.

**Safe human-checkpoint pattern:** each irreversible action is its own non-autonomous task. Immediately before asking, re-read and display the exact identity, successful prerequisite receipts, consequence, and single command. Prior blanket approval does not count.

| Checkpoint | Required displayed identity | Command held behind explicit confirmation | Disclosed side effect |
|---|---|---|---|
| Merge release PR | PR URL/number, base `master`, reviewed `headRefOid`, complete successful check table, merge strategy | `gh pr merge ... --merge --match-head-commit "$reviewed_head"` | Mutates `master` and triggers master Docker publication |
| Push tag | merged-master SHA, local master SHA, peeled tag SHA, remote tag absence | `git push gh refs/tags/v6.4.1:refs/tags/v6.4.1` | Creates public release ref and triggers SemVer GHCR images |
| Publish package | clean tree, branch/tag/HEAD equality, manifest tuple, successful dry run | `deno publish --check=local` | Creates immutable JSR version; interactive auth may open |

Never use `--admin`, `--auto`, `--squash`, `--allow-dirty`, `--set-version`, a force push, or `git push --tags`. Creating the local lightweight tag is reversible, but it must explicitly target the recorded merge SHA and be verified before its push checkpoint.

---

### `.planning/phases/05-v6-4-1-release/05-RELEASE-EVIDENCE.md` (evidence ledger, event-driven / append-only)

**Analog:** `.planning/phases/04-integrated-candidate-verification/04-VERIFICATION-EVIDENCE.md`

**Identity header pattern** (lines 1-23):

```yaml
---
phase: 04-integrated-candidate-verification
verified_at: 2026-10-05T17:52:21Z
status: pass
source_candidate: 331dabdd4189d3a90226650387341fb8aeae3ea6
---
```

Follow with a visible candidate-identity section containing full SHA, branch, start/end UTC timestamps, ancestry, clean-status assertion, and tool versions. Explicitly state which later documentation-only commit contains the ledger and which immutable source SHA each receipt verifies.

**Contribution matrix pattern** (lines 25-43):

```markdown
| Contribution | Immutable integration SHA | Original boundary exercised | Exact command and result |
| --- | --- | --- | --- |
| PR #53 | `3c1045f68a7e0b7e30f6f478ea2bddf60d2a5801` | ... | ... |
```

Seed all five exact integration SHAs from Phase 4, keyed by PR number rather than row order:

| PR | Integration SHA |
|---|---|
| #53 | `3c1045f68a7e0b7e30f6f478ea2bddf60d2a5801` |
| #54 | `0f6b99ab36fbe600190f80de7c1ad56a708640b0` |
| #62 | `3f68b6aebc87738a79d63181c06ce90b743ee229` |
| #63 | `a114fcebcefd0794799993c79a44ba0ade1fcdd7` |
| #64 | `2615f6f8ed98dfc65531dadff7180502dde32232` |

Phase 4's source candidate is `331dabdd4189d3a90226650387341fb8aeae3ea6`; cite it as historical regression/artifact evidence, not as the final release-preparation head. The version/changelog/docs commit requires a fresh coherent gate.

**Receipt structure:** use one table with `stage`, `source SHA`, `command/API`, `expected invariant`, `observed result`, `started/completed UTC`, `receipt URL or digest`, and `disposition`. Mark future remote facts `pending`; never invent merge/tag/publication values. Backfill them through a documentation-only follow-up branch/PR without moving `v6.4.1`.

**Artifact evidence pattern** (`04-VERIFICATION-EVIDENCE.md`, lines 80-116): retain sizes and first/second asset digests, Docker tag/resolved base/image ID, and evaluated Nix derivations/results. Record command facts and boundaries, not narrative claims.

---

### `nix/package.nix` (conditional build config, transform)

**Analog:** Phase 4's conditional fixed-output repair procedure in `.planning/phases/04-integrated-candidate-verification/04-02-PLAN.md` (lines 150-162).

Do not edit proactively. Run `deno task check:nix`; only a genuine fixed-output mismatch authorizes `deno task update:nix-hashes`. Inspect that only the reported `denoDepsHash` and/or client bundle hash changed, commit that repair separately, invalidate old receipts, and rerun the complete release-head gate on the new SHA. Any unrelated Nix failure remains a failure.

## Shared Patterns

### Exact GitHub Workflow and Check Naming

**Sources:** `.github/workflows/test.yml`, `.github/workflows/nix.yml`, `.github/workflows/docker-build.yml`, `.github/workflows/docker-image.yml`

| Workflow | Trigger relevant to Phase 5 | Job/check name | Release use |
|---|---|---|---|
| `Tests` | `push`, `pull_request` | `Deno Tests` | Must appear and succeed on the release PR |
| `Nix` | `push`, `pull_request` | `Flake Check` | Must appear and succeed on the release PR |
| `Docker build` | non-`master` branch push | job `build-image` | Candidate branch evidence; it is not a PR-triggered check |
| `Docker image` | `master` push and tags `v*.*.*` | job `build-and-push-image` | Merge/tag publication receipt; tag produces `6.4.1`, `6.4`, and `6` SemVer image tags |

Current server-side protection may report no required checks. Therefore do not treat an empty `gh pr checks --required` result as green. Query `statusCheckRollup`, require expected `Deno Tests` and `Flake Check`, record every additional observed check, and require literal successful completion of all rows. Pending, skipped, neutral, cancelled, action-required, or failing rows block the checkpoint. Re-fetch `headRefOid` immediately before merge and reject any change.

### SHA-Bound Evidence

Every local gate, PR check, merge result, tag, GHCR workflow, and JSR receipt must name its full source SHA. A commit change invalidates earlier release-head evidence. Exact commands and public receipt URLs/digests belong in the ledger; tokens, cookies, browser codes, and credential output never do.

### Release State Flow

```text
preparation SHA -> local gates -> release PR head/checks -> HUMAN merge
-> merged master SHA -> local tag at exact SHA -> HUMAN tag push
-> clean tagged checkout + dry run -> HUMAN publish -> public receipts
```

No later state may be inferred from an earlier one, and remote-result fields remain pending until the action actually succeeds.

## No Analog Found

None. The repository has exact metadata, CI, and evidence precedents. It does not have an earlier reusable release checklist, so the Phase 4 execution plan is the closest tracked procedural analog and Phase 5 research supplies the three explicit human gates.

## Metadata

**Analog search scope:** root release metadata, `.github/workflows/`, Phase 1 contribution review, Phase 4 plans/evidence, Nix version derivation
**Tracked analogs inspected:** 10
**Primary analogs retained:** 5 pattern groups
**Pattern extraction date:** 2026-10-06
