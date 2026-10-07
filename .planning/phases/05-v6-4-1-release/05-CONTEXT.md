# Phase 5: v6.4.1 Release - Context

**Gathered:** 2026-10-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Prepare, verify, and ship the v6.4.1 maintenance patch release with accurate release notes, authoritative version metadata, reusable release instructions, and end-to-end traceability. The release must flow from the `v6.4.1` candidate branch through a green GitHub release PR into `master`, then be tagged and published only from that merged canonical state.

</domain>

<decisions>
## Implementation Decisions

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
- Use Deno's default local-module type checking for publish dry runs and live publication. Do not use `--check=all`: it checks third-party npm declarations and exposes pre-existing upstream type errors that are outside this maintenance patch.
- Pause for explicit human confirmation immediately before each irreversible remote action: merging the release PR, pushing the `v6.4.1` tag, and publishing the Deno package. These actions must not be auto-approved.

### the agent's Discretion

Planning may choose the exact release-note layout, checklist filename, evidence-table structure, and safe read-only GitHub verification commands while preserving the gates above and repository conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `CHANGELOG.md` already contains the accumulated `Unreleased` entries and contributor attribution that must move into the v6.4.1 section.
- `deno.json` contains the authoritative package version, currently 6.4.0.
- Phase 1 contribution review and Phase 4 verification evidence already link the five selected pull requests to adapted commits, focused tests, package identities, and deterministic build results.
- GitHub Actions workflows provide Deno test, Docker, and Nix release-PR checks.

### Established Patterns

- Release work is developed on a dedicated `v<version>` branch based on `master`.
- Every user-facing change is accumulated under `CHANGELOG.md` → `Unreleased` until release cut.
- Deno formatting, lint, full tests, generated assets, Docker, and deterministic Nix validation are the release-quality gates.
- Planning and evidence artifacts retain exact SHAs and command results rather than relying on narrative claims.

### Integration Points

- `deno.json` version metadata feeds the package and Nix/Docker release outputs.
- `v6.4.1` must become a GitHub PR into `master`; required CI state gates merge.
- The local checkout must switch/update to merged `master` before tag creation and Deno publication.
- Release evidence must connect GitHub state and publication output back to Phase 4's verified source candidate and the selected contribution record.

</code_context>

<specifics>
## Specific Ideas

- This is a maintenance patch release, not an MVP and not a feature release.
- Separate reversible preparation from remote merge/tag/publish checkpoints so local work can be completed without silently performing irreversible release actions.

</specifics>

<deferred>
## Deferred Ideas

- PR #55 MIME filtering and PR #60 media configuration/UI changes remain deferred to v6.5.
- Any new feature or broad release-process redesign remains outside v6.4.1.

</deferred>
