# Phase 4: Integrated Candidate Verification - Context

**Gathered:** 2026-10-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify that the combined v6.4.1 release candidate is protocol-compatible, storage-safe, and reproducible across the affected Deno, generated-asset, Docker, and Nix gates. This phase closes verification gaps and records evidence; it does not add unrelated product capabilities.

</domain>

<decisions>
## Implementation Decisions

### Verification scope

- Map every selected contribution to focused regression tests and preserve existing coverage.
- Resolve or explicitly disposition both advisory findings before release: active content carried by `multipart/x-mixed-replace` and weak `If-None-Match` comparison semantics.
- Use real Hono `app.fetch()`, in-memory LibSQL, and temporary local storage for end-to-end coverage; do not require live external services.
- Retain commands, outcomes, contribution-to-test mapping, and artifact freshness checks as Phase 4 evidence.

### Quality and build gates

- Require `deno fmt --check`, `deno lint`, and the complete `deno task test` suite to pass together.
- Run `deno task build`, then verify the worktree contains no unexplained generated changes.
- Build the release Docker image locally and record the result.
- Run `deno task check:nix`; if fixed-output hashes are stale, use the documented hash-update workflow and rerun the deterministic check.

### Backend and streaming validation

- Assert early rejection and request-body cancellation without buffering, including streamed or large-body cases.
- Exercise real temporary local filesystem storage through complete route flows.
- Dedicated S3 execution is not necessary for this phase: the work required to add or operate an S3 test harness is disproportionate for this patch release. Do not require production credentials or live S3 infrastructure; rely on the established storage interface boundary, existing adapter coverage, and code-level compatibility review.
- Treat preservation of response codes, authorization scope, content headers, hash integrity, and established BUD route behavior as the protocol-compatibility boundary.

### the agent's Discretion

Planning may choose the exact test files, evidence document structure, and deterministic Docker/Nix invocation details while preserving repository conventions and the decisions above.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- Route tests already construct the real Hono application with `buildApp()` and invoke it through `app.fetch()`.
- In-memory LibSQL and `Deno.makeTempDir()` provide deterministic database and local-storage integration fixtures.
- Existing upload, blob, authentication, logger, and storage tests provide natural homes for focused regression cases.
- `deno task build`, `deno task check:nix`, and the Dockerfile expose the required build/package gates.

### Established Patterns

- Tests use Deno's built-in runner and `@std/assert`, real signed Nostr events, in-memory databases, and temporary directories rather than broad mocks.
- Upload-related tests preserve streaming semantics and may disable resource sanitizers for persistent worker resources.
- Generated outputs must be checked for unexplained worktree changes, and Nix checks must force rebuilds so cached store paths cannot mask stale artifacts.

### Integration Points

- Regression coverage spans `src/routes/`, authentication middleware, blob response handling, request logging, local storage, and their corresponding unit/e2e tests.
- Verification evidence connects the five selected contribution records to tests, quality gates, generated assets, Docker packaging, and Nix outputs.
- Phase 4 must explicitly disposition the two advisory findings already recorded in `.planning/STATE.md` before Phase 5 release work begins.

</code_context>

<specifics>
## Specific Ideas

- Prefer deterministic in-process checks and repository-native build commands.
- Do not introduce a live S3 dependency or a new S3 integration harness solely for this release verification phase.

</specifics>

<deferred>
## Deferred Ideas

- Dedicated live or emulated S3 end-to-end testing remains outside this patch milestone unless a concrete regression demonstrates that it is necessary.

</deferred>
