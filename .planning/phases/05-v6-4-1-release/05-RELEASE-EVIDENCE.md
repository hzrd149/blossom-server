---
phase: 05-v6-4-1-release
release: v6.4.1
status: preparation-pending
phase_4_source_candidate: 331dabdd4189d3a90226650387341fb8aeae3ea6
---

# v6.4.1 Release Evidence

This append-only ledger connects the five selected upstream contributions to the verified Phase 4 source candidate and the eventual release outputs. Known immutable inputs are seeded below. Remote facts that do not yet exist are explicitly `pending`; they must be backfilled only from reproducible read-only receipts in the post-publication documentation follow-up PR.

## Immutable candidate inputs

- **Release branch:** `v6.4.1`
- **Base branch:** `master`
- **Phase 4 source candidate:** `331dabdd4189d3a90226650387341fb8aeae3ea6`
- **Phase 4 evidence:** `.planning/phases/04-integrated-candidate-verification/04-VERIFICATION-EVIDENCE.md`
- **Contribution decisions and attribution:** `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md`
- **Phase 4 focused matrix:** 234 passed, 0 failed on the exact twelve-file contribution command.
- **Phase 4 complete suite:** 395 server tests and 2 client tests passed, 0 failed.
- **Accepted storage boundary:** real temporary LocalStorage runtime evidence plus S3 interface/type/build compatibility; no live or emulated S3 runtime is claimed.

Phase 4 results are historical inputs. They are bound to the Phase 4 source candidate and are not substitutes for the complete v6.4.1 preparation-head gate.

## Contribution traceability

| Contribution | Immutable integration SHA | Included boundary | Historical focused evidence | Release note |
| --- | --- | --- | --- | --- |
| PR [#53](https://github.com/hzrd149/blossom-server/pull/53) by [@mptfire](https://github.com/mptfire) | `3c1045f68a7e0b7e30f6f478ea2bddf60d2a5801` | Reject multipart and URL-encoded upload envelopes before auth/body processing | Phase 4 C1: pass, 234/0 | v6.4.1 Patch Changes |
| PR [#54](https://github.com/hzrd149/blossom-server/pull/54) by [@mptfire](https://github.com/mptfire) | `0f6b99ab36fbe600190f80de7c1ad56a708640b0` | Reject malformed blob/static paths before filesystem work while preserving valid paths | Phase 4 C1: pass, 234/0 | v6.4.1 Patch Changes |
| PR [#62](https://github.com/hzrd149/blossom-server/pull/62) by [@mptfire](https://github.com/mptfire) | `3f68b6aebc87738a79d63181c06ce90b743ee229` | Strict expiration parsing and exact blob-hash authorization scope without a fixed lifetime cap | Phase 4 C1: pass, 234/0 | v6.4.1 Patch Changes |
| PR [#63](https://github.com/hzrd149/blossom-server/pull/63) by [@mptfire](https://github.com/mptfire) | `a114fcebcefd0794799993c79a44ba0ade1fcdd7` | Isolate stored active content while preserving normal GET/HEAD/range/conditional behavior | Phase 4 C1: pass, 234/0 | v6.4.1 Patch Changes |
| PR [#64](https://github.com/hzrd149/blossom-server/pull/64) by [@mptfire](https://github.com/mptfire) | `2615f6f8ed98dfc65531dadff7180502dde32232` | Omit complete query data from paired access logs while preserving operational context | Phase 4 C1: pass, 234/0 | v6.4.1 Patch Changes |

The sixth v6.4.1 patch note records the Phase 4 validator-list compatibility correction discovered while verifying the integrated candidate.

## Release receipt ledger

| Stage | Source SHA | Command or API | Expected invariant | Observed result | Started / completed UTC | Receipt URL or digest | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preparation head | `pending` | `git rev-parse refs/heads/v6.4.1` | Full committed release-input SHA | `pending` | `pending` | `pending` | pending |
| Structural metadata | `pending` | Deno manifest/changelog assertion | 6.4.1; empty Unreleased; six dated bullets; five PR links; historical 6.4.0 retained | `pending` | `pending` | `pending` | pending |
| Deno quality | `pending` | `deno fmt --check && deno lint && deno check --frozen main.ts && deno task test` | Every command passes on one clean SHA | `pending` | `pending` | `pending` | pending |
| Asset determinism | `pending` | two bounded fresh `deno task build` runs | Non-empty identical SHA-256 digests for both generated assets | `pending` | `pending` | `pending` | pending |
| Docker image | `pending` | `docker build --pull --no-cache --progress=plain` | SHA-named image has inspectable ID | `pending` | `pending` | `pending` | pending |
| Nix gate | `pending` | `deno task check:nix` plus two version evaluations | All declared outputs rebuild/check; derived versions equal 6.4.1 | `pending` | `pending` | `pending` | pending |
| Deno dry run | `pending` | `deno publish --dry-run --check=local` | `@hzrd149/blossom-server@6.4.1`, no upload | `pending` | `pending` | `pending` | pending |
| GitHub branch | `pending` | `git ls-remote gh refs/heads/v6.4.1` | Remote branch equals verified preparation head | `pending` | `pending` | `pending` | pending |
| Release PR | `pending` | GitHub PR `v6.4.1` → `master` | Exactly one open non-draft PR at verified head | `pending` | `pending` | `pending` | pending |
| PR checks | `pending` | GitHub `statusCheckRollup` | `Deno Tests`, `Flake Check`, and every observed check successful on reviewed head | `pending` | `pending` | `pending` | pending |
| Merge | `pending` | guarded merge with reviewed head | Merge commit on GitHub `master` contains reviewed head | `pending` | `pending` | `pending` | pending — blocking-human gate 1 |
| Master GHCR run | `pending` | GitHub Actions receipt | `master`-push image workflow succeeds for merge SHA | `pending` | `pending` | `pending` | pending |
| Tag | `pending` | `refs/tags/v6.4.1:refs/tags/v6.4.1` | Remote lightweight tag peels to exact merged-master SHA | `pending` | `pending` | `pending` | pending — blocking-human gate 2 |
| Tag GHCR run | `pending` | GitHub Actions receipt | Tag workflow succeeds and publishes expected SemVer image tags/digests | `pending` | `pending` | `pending` | pending |
| JSR publication | `pending` | `deno publish --check=local` and public metadata read | Immutable `@hzrd149/blossom-server@6.4.1` originates from clean tagged merged master | `pending` | `pending` | `pending` | pending — blocking-human gate 3 |
| Evidence follow-up | `pending` | documentation-only PR | Only this ledger is backfilled; `v6.4.1` does not move | `pending` | `pending` | `pending` | pending |

## Preparation artifact details

These values remain pending until the complete gate succeeds on one sealed preparation SHA.

| Artifact | Size | First SHA-256 | Second SHA-256 / identity |
| --- | ---: | --- | --- |
| `public/client.js` | pending | pending | pending |
| `public/styles.css` | pending | pending | pending |
| Docker image | pending | pending | pending image ID |
| Nix `denoDeps` | pending | pending | pending derivation/output |
| Nix `clientBundle` | pending | pending | pending derivation/output |
| Nix `styles` | pending | pending | pending derivation/output |
| Nix package | pending | pending | pending derivation/output |

## Invalidation log

No invalidation has occurred yet. Append an entry whenever a preparation commit, date correction, generated output, diagnosed hash repair, PR-head change, failed/omitted gate, or dirty worktree invalidates earlier evidence. Never delete or silently overwrite a superseded receipt.

## Prohibited inference

The pending PR number/URL/checks, merge/master SHA, tag, GHCR workflow receipts, JSR receipt, and documentation follow-up PR do not yet exist in this ledger. Their eventual values must not be inferred from the branch name, an earlier release, Phase 4 evidence, or an intended command.
