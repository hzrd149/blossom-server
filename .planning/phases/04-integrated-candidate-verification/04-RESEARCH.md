# Phase 4: Integrated Candidate Verification - Research

**Researched:** 2026-10-05

**Domain:** Integrated protocol, streaming, storage-boundary, generated-asset, Docker, and Nix release-candidate verification

**Confidence:** HIGH for repository architecture and test mapping; MEDIUM for externally cited protocol/build guidance

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

### Verification scope

- Map every selected contribution to focused regression tests and preserve existing coverage.
- Resolve or explicitly disposition both advisory findings before release: active content carried by `multipart/x-mixed-replace` and weak `If-None-Match`
  comparison semantics.
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
- Dedicated S3 execution is not necessary for this phase: the work required to add or operate an S3 test harness is disproportionate for this patch release. Do
  not require production credentials or live S3 infrastructure; rely on the established storage interface boundary, existing adapter coverage, and code-level
  compatibility review.
- Treat preservation of response codes, authorization scope, content headers, hash integrity, and established BUD route behavior as the protocol-compatibility
  boundary.

### the agent's Discretion

Planning may choose the exact test files, evidence document structure, and deterministic Docker/Nix invocation details while preserving repository conventions
and the decisions above.

### Deferred Ideas (OUT OF SCOPE)

- Dedicated live or emulated S3 end-to-end testing remains outside this patch milestone unless a concrete regression demonstrates that it is necessary.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                                         | Research Support                                                                                                                                                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VERI-01 | Maintainer can verify every integrated fix with focused regression tests covering its original failure or security condition.       | The contribution matrix below maps PRs #53, #54, #62, #63, and #64 to their existing focused files and identifies the two advisory regressions still missing. [VERIFIED: `.planning/REQUIREMENTS.md:24-29`; `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:27-146`]                                                            |
| VERI-02 | Maintainer can run formatting, linting, and the complete Deno test suite successfully on the integrated release candidate.          | The repository-native commands are defined in AGENTS.md and `deno.json`; baseline lint and tests pass, while formatter hygiene needs a Wave 0 fix for generated `.gsd` state. [VERIFIED: `AGENTS.md:15-62`; `deno.json:12-24`; commands executed 2026-10-05]                                                                                             |
| VERI-03 | Maintainer can verify affected generated assets, Docker packaging, and Nix artifacts without relying on stale build outputs.        | The generated assets are ignored, Docker currently uses a mutable base tag, and the Nix script deliberately realizes and rebuilds four targets; the plan must capture hashes/IDs rather than rely on worktree diff alone. [VERIFIED: `.gitignore:9-10`; `Dockerfile:14-36`; `scripts/nix-check.sh:5-21`]                                                 |
| VERI-04 | Maintainer can confirm the combined changes preserve Blossom protocol compatibility, streaming behavior, and both storage backends. | Real local-storage route flows cover the runtime behavior; `IBlobStorage`, both implementations, `main.ts`, and a frozen full-import-graph typecheck provide the deterministic S3 boundary evidence without a live S3 harness. [VERIFIED: `src/storage/interface.ts:12-104`; `src/storage/local.ts:18-190`; `src/storage/s3.ts:28-300`; `main.ts:18-82`] |

</phase_requirements>

## Summary

Plan this phase as two ordered verification waves. First, close the two known advisory gaps at the centralized response-policy boundary: classify exact
normalized `multipart/x-mixed-replace` as active content and implement RFC 9110 weak comparison for `If-None-Match`, with unit and real `buildApp(...).fetch()`
coverage. Second, run one immutable-candidate evidence pipeline: contribution-focused matrix, frozen import-graph check, format/lint/full suite, clean
generated-asset builds, fresh local Docker build, and deterministic Nix rebuild/check. [VERIFIED: `.planning/STATE.md:96-103`; `src/utils/mime.ts:9-18`;
`src/routes/blobs.ts:70-105`] [CITED: https://html.spec.whatwg.org/multipage/iana.html] [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2]

Do not introduce live S3, MinIO, LocalStack, production credentials, or a new S3 harness. The established route layer consumes `IBlobStorage`; both
`LocalStorage` and `S3Storage` implement that contract, both stage writes to local temporary files, and `main.ts` selects either implementation before passing
it to the same application. The correct Phase 4 evidence is: full real local-storage flows, adapter contract/code review, `deno check --frozen main.ts`, and
Docker/Nix builds that traverse the production import graph. [VERIFIED: `src/storage/interface.ts:26-104`; `src/storage/local.ts:97-155`;
`src/storage/s3.ts:166-240`; `main.ts:49-82`] [VERIFIED: command `deno check --frozen main.ts` exited 0 on 2026-10-05]

The planner must account for two repository/tooling mismatches. First, AGENTS.md and CONTEXT.md name `check:nix`/`update:nix-hashes`, but `deno.json` currently
exposes `nix:check`/`nix:update`; add compatibility aliases or otherwise reconcile the locked command before the final gate. Second, `public/client.js` and
`public/styles.css` are ignored and currently absent, so `git diff` cannot prove freshness; delete only those known generated outputs when present, rebuild
twice, compare SHA-256 hashes, assert both files exist, and separately prove no tracked changes appeared. [VERIFIED: `AGENTS.md:44-73`; `deno.json:17-23`;
`.gitignore:9-10`; direct filesystem probe on 2026-10-05]

**Primary recommendation:** Use one implementation plan for the two advisory fixes and focused regressions, followed by one evidence plan that runs all gates
against a recorded candidate SHA and writes a single auditable verification record.

## Architectural Responsibility Map

| Capability                     | Primary Tier         | Secondary Tier     | Rationale                                                                                                                                                                                       |
| ------------------------------ | -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active-content classification  | API / Backend        | Browser / Client   | Stored MIME controls server response headers; the browser is the threatened interpreter. [VERIFIED: `src/routes/blobs.ts:70-85`; `src/utils/mime.ts:9-18`]                                      |
| Conditional ETag evaluation    | API / Backend        | CDN / Static       | The blob route evaluates `If-None-Match` before storage reads and emits `304` metadata used by clients/caches. [VERIFIED: `src/routes/blobs.ts:87-105`]                                         |
| Contribution regression matrix | API / Backend        | Database / Storage | Route/auth behavior is primary; LibSQL and storage fixtures supply real state and bytes. [VERIFIED: `tests/e2e/active-content.test.ts:23-58`; `tests/e2e/upload.test.ts:100-136`]               |
| Local storage safety           | Database / Storage   | API / Backend      | `LocalStorage` owns staged/final files; routes own status, cancellation, and authorization decisions. [VERIFIED: `src/storage/local.ts:18-190`; `src/routes/upload.ts:333-429`]                 |
| S3 compatibility evidence      | Database / Storage   | API / Backend      | `S3Storage` owns remote I/O but implements the same injected `IBlobStorage` seam consumed by routes. [VERIFIED: `src/storage/interface.ts:26-104`; `src/storage/s3.ts:28-300`; `main.ts:49-82`] |
| Generated UI assets            | Browser / Client     | CDN / Static       | Deno tasks bundle the client and compile CSS into ignored `public/` outputs served by the top-level app. [VERIFIED: `deno.json:17-21`; `.gitignore:9-10`; `src/routes/landing.tsx:17-19`]       |
| Docker/Nix candidate packaging | Build / Packaging    | API / Backend      | These gates package the production entry point and generated assets without changing protocol semantics. [VERIFIED: `Dockerfile:21-43`; `flake.nix:34-59`; `nix/package.nix:9-65`]              |
| Verification evidence          | Repository / Release | All tiers          | The evidence record binds candidate SHA, contribution commits, commands, outcomes, and artifact identities. [VERIFIED: `.planning/phases/04-integrated-candidate-verification/04-CONTEXT.md`]   |

## Standard Stack

This phase installs no external packages and should not update dependencies. Preserve the versions already resolved in `deno.lock`; dependency churn would
expand a patch-release verification phase without supporting a requirement. [VERIFIED: `deno.lock:1-28`; `.planning/REQUIREMENTS.md:49-56`]

### Core

| Library / Tool                  | Version                   | Purpose                                                     | Why Standard Here                                                                                                                                                   |
| ------------------------------- | ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deno                            | 2.9.5 installed           | Formatter, linter, typechecker, test runner, tasks, bundler | Repository-native toolchain; the environment probe and baseline suite used this exact binary. [VERIFIED: `AGENTS.md:15-47`; command `deno --version` on 2026-10-05] |
| Hono                            | 4.12.7 resolved           | Real in-process HTTP application and middleware routing     | Existing E2E convention uses production `buildApp()` and `app.fetch()`. [VERIFIED: `deno.lock:5-6,41-43`; `tests/e2e/active-content.test.ts:8,58-63`]               |
| `@libsql/client`                | 0.17.0 resolved           | Embedded metadata database                                  | Existing tests initialize actual temporary LibSQL databases. [VERIFIED: `deno.lock:15-16`; `tests/e2e/active-content.test.ts:24-26`]                                |
| `@std/assert`                   | 1.0.19 resolved           | Test assertions                                             | Existing unit and E2E tests already use it; no test framework addition is needed. [VERIFIED: `deno.lock:7,44-49`; `tests/e2e/active-content.test.ts:1`]             |
| `IBlobStorage` + `LocalStorage` | Repository implementation | Storage seam and real temporary filesystem implementation   | This is the locked deterministic storage boundary for Phase 4. [VERIFIED: `src/storage/interface.ts:26-104`; `src/storage/local.ts:18-190`]                         |

### Supporting

| Tool                     | Version          | Purpose                                                        | When to Use                                                                                                                                                                                                          |
| ------------------------ | ---------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Engine / BuildKit | 29.8.0 installed | Fresh local release image build                                | Run after source/tests and generated assets are final; use `--pull --no-cache` and record the image ID. [VERIFIED: environment probe 2026-10-05] [CITED: https://docs.docker.com/reference/cli/docker/buildx/build/] |
| Nix                      | 2.34.7 installed | Sandboxed fixed-output and final-package verification          | Run the repository script after Docker; update hashes only on a genuine fixed-output mismatch. [VERIFIED: environment probe 2026-10-05; `scripts/nix-check.sh:5-21`; `scripts/nix-update-hashes.sh:46-74`]           |
| Git                      | 2.53.0 installed | Candidate identity, contribution traceability, worktree checks | Snapshot branch/SHA/status before gates and repeat after them. [VERIFIED: environment probe 2026-10-05]                                                                                                              |
| `sha256sum`              | host utility     | Compare ignored generated assets across two clean builds       | Use because Git intentionally ignores the two outputs. [VERIFIED: `.gitignore:9-10`; filesystem probe 2026-10-05]                                                                                                    |

### Alternatives Considered

| Instead of                                            | Could Use                     | Tradeoff                                                                                                                               |
| ----------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Real local storage plus code-level S3 boundary review | Live S3, MinIO, or LocalStack | Explicitly out of scope; adds credentials/service/harness cost without a concrete regression requiring it. [VERIFIED: `04-CONTEXT.md`] |
| Repository-native Deno runner                         | Jest/Vitest or Node scripts   | Contradicts the Deno-only project convention and adds dependencies with no coverage benefit. [VERIFIED: `AGENTS.md:15-17,338-365`]     |
| Repository Nix scripts                                | Ad hoc `nix build` only       | Misses the deliberate realize-then-`--rebuild` sequence and flake check. [VERIFIED: `scripts/nix-check.sh:5-21`]                       |

**Installation:** None.

## Package Legitimacy Audit

Not applicable. Phase 4 should install no new packages and preserve the existing Deno lockfiles. [VERIFIED: recommended scope derived from
`.planning/REQUIREMENTS.md:24-29` and `04-CONTEXT.md`]

## Architecture Patterns

### System Architecture Diagram

```text
selected PR records + candidate SHA
                 |
                 v
      contribution-to-test matrix
                 |
       +---------+----------+
       |                    |
       v                    v
 focused advisory       existing focused suites
 regressions            (#53/#54/#62/#63/#64)
       |                    |
       +---------+----------+
                 v
       real Hono buildApp().fetch()
                 |
       +---------+----------+
       |                    |
       v                    v
 in-memory LibSQL     temp LocalStorage
       |                    |
       +---------+----------+
                 v
 protocol/stream/auth/header/hash assertions
                 |
       +---------+----------+-------------------+
       |                    |                   |
       v                    v                   v
 fmt + lint + tests   clean asset builds   frozen main.ts check
       |                    |                   |
       +---------+----------+-------------------+
                 v
         fresh Docker build
                 |
                 v
    Nix realize -> rebuild -> flake check
                 |
                 v
 evidence record: commands, exits, hashes, image ID,
 contribution mapping, advisory dispositions, final status
```

The route and storage flow shown above matches the production injection seam and the locked in-process test strategy. [VERIFIED: `src/server.ts:28-85`;
`src/storage/interface.ts:26-104`; `tests/e2e/active-content.test.ts:23-58`]

### Recommended Project Structure

```text
src/
├── utils/mime.ts                    # centralized persisted-MIME classifier
└── routes/blobs.ts                  # conditional request and response policy
tests/
├── unit/mime.test.ts                # classifier truth table
└── e2e/active-content.test.ts       # real app/DB/local-storage response matrix
.planning/phases/04-integrated-candidate-verification/
├── 04-CONTEXT.md
├── 04-RESEARCH.md
└── 04-VERIFICATION-EVIDENCE.md      # recommended command/result/artifact ledger
```

The existing implementation/test paths are source-of-truth; the evidence filename is a planning recommendation within the agent's discretion. [VERIFIED:
`src/utils/mime.ts`; `src/routes/blobs.ts`; `tests/unit/mime.test.ts`; `tests/e2e/active-content.test.ts`]

### Pattern 1: Close Advisory Findings at the Central Policy Boundary

**What:** Extend `isActiveContentMime()` for the exact normalized multipart document type and isolate ETag matching into a small pure helper or equivalently
focused block. Keep stored MIME as the response-policy authority and keep conditional evaluation ahead of storage streaming. [VERIFIED:
`src/utils/mime.ts:9-18`; `src/routes/blobs.ts:54-105`]

**When to use:** Before the combined regression/build gate, because both findings affect the release candidate's protocol/security result. [VERIFIED:
`.planning/STATE.md:96-101`]

**Why:** The WHATWG registration says multipart parts may include `text/html`, and RFC 9110 requires weak comparison for `If-None-Match`. [CITED:
https://html.spec.whatwg.org/multipage/iana.html] [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2]

### Pattern 2: Contribution-to-Test Traceability

Use this as the minimum evidence matrix; add the new advisory cases under PR #63 / integrated blob behavior rather than inventing a sixth contribution.
[VERIFIED: `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:27-146`]

| Contribution | Immutable Commit                           | Focused Tests                                                                                                        | Boundary Proved                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #53       | `3c1045f68a7e0b7e30f6f478ea2bddf60d2a5801` | `tests/unit/envelope.test.ts`, `tests/e2e/upload.test.ts`, `tests/e2e/media.test.ts`                                 | Envelope rejection occurs before auth/body processing; rejected streams are cancelled without pulling; raw bodies remain compatible. [VERIFIED: contribution review lines 27-47; `tests/e2e/upload.test.ts:343-430`; `tests/e2e/media.test.ts:407-451`] |
| PR #54       | `0f6b99ab36fbe600190f80de7c1ad56a708640b0` | `tests/unit/blob-path.test.ts`, `tests/unit/url.test.ts`, `tests/e2e/blobs.test.ts`                                  | Malformed blob/static paths fall through safely while accepted hashes, suffixes, and static boundary controls remain compatible. [VERIFIED: contribution review lines 49-77; `tests/e2e/blobs.test.ts:168-374`]                                         |
| PR #62       | `3f68b6aebc87738a79d63181c06ce90b743ee229` | `tests/unit/auth.test.ts`, `tests/e2e/upload.test.ts`, `tests/e2e/delete.test.ts`, `tests/e2e/list.test.ts`          | Strict expiration, required exact hash scope, no fixed 30-day cap, denied-write cleanup, and protected route behavior. [VERIFIED: contribution review lines 79-101; `tests/unit/auth.test.ts:143-205,343-394`; `tests/e2e/upload.test.ts:522-685`]      |
| PR #63       | `a114fcebcefd0794799993c79a44ba0ade1fcdd7` | `tests/unit/mime.test.ts`, `tests/e2e/active-content.test.ts`, `tests/e2e/blobs.test.ts`, `tests/unit/range.test.ts` | Stored-MIME active-content isolation across GET/HEAD/206/304 while preserving ordinary streaming/ranges; add multipart and weak-validator regressions here. [VERIFIED: contribution review lines 103-126; `tests/e2e/active-content.test.ts:23-138`]    |
| PR #64       | `2615f6f8ed98dfc65531dadff7180502dde32232` | `tests/unit/logger.test.ts`                                                                                          | Both paired lines use the same encoded pathname, omit query data, and retain method/status/timing/reason. [VERIFIED: contribution review lines 128-146; `tests/unit/logger.test.ts:5-33`]                                                               |

The five commits are currently each present exactly once as non-merge `Contribution-PR` commits, the branch is `v6.4.1`, and `master` is an ancestor. [VERIFIED:
git commands executed 2026-10-05]

### Pattern 3: Real Local Storage, Interface-Level S3 Evidence

**What:** Use `Deno.makeTempDir()`, actual LibSQL, actual `LocalStorage`, and the production Hono app for behavioral evidence. Pair it with a method-by-method
review of `IBlobStorage`, `LocalStorage`, and `S3Storage`, plus `deno check --frozen main.ts` and package builds. [VERIFIED:
`tests/e2e/active-content.test.ts:23-58`; `src/storage/interface.ts:26-104`; `main.ts:18-82`]

**When to use:** For VERI-04 and all route/storage compatibility assertions.

**Boundary checklist:**

- `has`, `read`, optional `readRange`, `size`, `type`, `beginWrite`, `commitWrite`, `abortWrite`, `commitFile`, and `remove` remain present on the contract and
  both adapters. DATA_7F3A2C91_START `IBlobStorage` declares these operations. DATA_7F3A2C91_END [VERIFIED: `src/storage/interface.ts:26-104`; implementations
  opened at `src/storage/local.ts:40-190` and `src/storage/s3.ts:89-240`]
- Both adapters stage writes on local disk before commit; S3 uploads only from the staged verified path and always attempts local cleanup. [VERIFIED:
  `src/storage/local.ts:97-155`; `src/storage/s3.ts:166-230,242-298`]
- The same `IBlobStorage` instance is injected into `buildApp()` regardless of backend selection. [VERIFIED: `main.ts:49-82,111-112`; `src/server.ts:28-32`]
- Do not claim live S3 behavior was executed; label this evidence "contract/type/build compatibility" and retain the explicit deferred live-harness note.
  [VERIFIED: `04-CONTEXT.md`]

### Pattern 4: Freshness Evidence for Ignored Generated Assets

**What:** Capture a pre-gate tracked worktree snapshot, remove only `public/client.js` and `public/styles.css` if present, run `deno task build`, assert both
outputs exist, hash them, rebuild from the same source, hash again, and compare. Then confirm no new tracked diff. [VERIFIED: exact output paths in
`deno.json:20-21`; ignore rules in `.gitignore:9-10`]

**Why:** Git cannot report changes to ignored outputs, so `git diff --exit-code` alone is not evidence that they were regenerated or deterministic. [VERIFIED:
`.gitignore:9-10`; `git check-ignore -v` and absence probe executed 2026-10-05]

### Pattern 5: Immutable-Candidate Evidence Ledger

Record these fields once, before the first final gate, and repeat the SHA/status checks after the last gate:

| Evidence Group        | Required Fields                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Candidate identity    | UTC timestamp, branch, full `HEAD`, `master` ancestry, initial `git status --short`                           |
| Contribution mapping  | PR number, immutable contribution SHA, requirement, focused command, result                                   |
| Advisory disposition  | finding, code/test change or explicit accepted disposition, authoritative basis, focused result               |
| Deno gates            | exact command, Deno version, exit status, pass counts                                                         |
| Generated assets      | source `HEAD`, first and second SHA-256 per output, equality result, tracked worktree delta                   |
| Docker                | exact command, Docker version, tag, image ID/digest, build exit status                                        |
| Nix                   | exact task/script, Nix version, realized/rebuilt targets, flake result, any hash update diff and rerun        |
| Storage compatibility | local route-flow results, interface/adapters reviewed, frozen `main.ts` check, explicit "no live S3" boundary |
| Final state           | final `HEAD`, final worktree status, unexplained-change disposition                                           |

This ledger content follows the locked evidence decision and existing five-contribution traceability contract. [VERIFIED: `04-CONTEXT.md`;
`.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:10-25`]

### Anti-Patterns to Avoid

- **One giant new “integration” test:** it duplicates strong focused suites, obscures which contribution regressed, and adds shared-fixture fragility. Add only
  the two missing advisory cases and execute the mapped files together.
- **Exact-name filters on shared-fixture E2E cases:** upload/blob/delete/list suites use ordinary setup tests, so filtering a later case can skip
  initialization. Run the whole relevant file unless the target test is made self-contained. [VERIFIED: `tests/e2e/upload.test.ts:90-136`; Phase 1 verification
  at `.planning/phases/01-request-intake-boundaries/01-VERIFICATION.md:152-184`]
- **Treating direct upload rejection as multipart response isolation:** mirror/imported or previously stored metadata can still reach blob retrieval;
  classification must occur at persisted-MIME response time. [VERIFIED: `src/middleware/envelope.ts:8-38`; `src/routes/blobs.ts:54-85`; Phase 3 review lines
  36-62]
- **Claiming S3 runtime coverage:** the locked scope expressly excludes it; distinguish interface/type/build compatibility from live object-store execution.
  [VERIFIED: `04-CONTEXT.md`]
- **Running mutable hash updates preemptively:** `scripts/nix-update-hashes.sh` edits `nix/package.nix`; run it only after the deterministic check reports a
  genuine mismatch, inspect the exact diff, then rerun the full check. [VERIFIED: `scripts/nix-update-hashes.sh:31-74`]

## Don't Hand-Roll

| Problem                    | Don't Build                                    | Use Instead                                                           | Why                                                                                                                                                          |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP integration harness   | Real socket server or custom request simulator | Production `buildApp()` with `app.fetch()`                            | Existing deterministic path exercises middleware and routes without a port. [VERIFIED: `AGENTS.md:349-358`; `tests/e2e/active-content.test.ts:58-63`]        |
| Metadata fixture           | Fake repository object                         | Actual temporary LibSQL database                                      | Preserves real schema/query behavior. [VERIFIED: `tests/e2e/active-content.test.ts:24-50`]                                                                   |
| Storage behavior           | In-memory byte map                             | Actual `LocalStorage` under `Deno.makeTempDir()`                      | Exercises staging, commit, read/range, and cleanup semantics. [VERIFIED: `tests/e2e/active-content.test.ts:24-43`; `tests/unit/local-storage.test.ts:29-92`] |
| Auth tokens                | Handwritten event JSON                         | Existing real Nostr signing helpers                                   | Prevents fixtures from bypassing signature/parsing behavior. [VERIFIED: `AGENTS.md:361-364`; `tests/unit/auth.test.ts`]                                      |
| Asset bundler/CSS pipeline | New scripts                                    | Existing `deno task build` dependencies                               | Uses the same frozen lockfiles and commands as CI/Docker. [VERIFIED: `deno.json:17-21`; `.github/workflows/test.yml:25-29`; `Dockerfile:28-36`]              |
| Nix freshness checker      | Custom store cleanup logic                     | `scripts/nix-check.sh` and conditional `scripts/nix-update-hashes.sh` | Existing script realizes, force-rebuilds, and checks the flake. [VERIFIED: `scripts/nix-check.sh:5-21`; `scripts/nix-update-hashes.sh:70-74`]                |
| S3 integration service     | New emulator/harness                           | Contract review + frozen import-graph check + packaging gates         | Locked out of scope and unnecessary absent a concrete S3 regression. [VERIFIED: `04-CONTEXT.md`]                                                             |
| Broad HTTP cache library   | New dependency for one header                  | Small RFC-scoped matcher with focused tests                           | The required behavior is narrow and fully specified by weak entity-tag comparison. [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2]      |

**Key insight:** Phase 4 should increase confidence by composing existing production seams and focused tests, not by adding parallel infrastructure.

## Common Pitfalls

### Pitfall 1: Strong-Only `If-None-Match` Parsing

**What goes wrong:** `W/"<hash>"` returns a full `200` instead of `304` because the current code removes quotes but leaves the weak marker. [VERIFIED:
`src/routes/blobs.ts:87-105`; `.planning/phases/03-content-and-logging-boundaries/03-REVIEW.md:66-84`]

**Why it happens:** The implementation compares normalized strings rather than entity-tag opaque values.

**How to avoid:** Compare the server's quoted ETag against each comma-separated candidate after removing only an optional valid `W/` prefix; treat exact `*` as
the wildcard alternative. Add strong, weak, mixed-list, non-match, and wildcard route assertions. [CITED:
https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2]

**Warning signs:** Tests only cover the strong form currently used at `tests/e2e/active-content.test.ts:85-95`. [VERIFIED:
`tests/e2e/active-content.test.ts:85-95`]

### Pitfall 2: Missing Multipart Active Documents

**What goes wrong:** A stored `multipart/x-mixed-replace` blob remains inline even though its parts can carry `text/html`. [VERIFIED: `src/utils/mime.ts:9-18`;
`.planning/phases/03-content-and-logging-boundaries/03-REVIEW.md:36-62`] [CITED: https://html.spec.whatwg.org/multipage/iana.html]

**Why it happens:** The classifier currently covers HTML/XML families, while request-envelope rejection creates a false sense that all multipart risk is closed.

**How to avoid:** Add the exact normalized base type to `isActiveContentMime()` and seed a real multipart fixture through the existing active-content route
matrix. Preserve ordinary `multipart/*` disposition unless separately justified; the finding is for the exact browser document type. [CITED:
https://html.spec.whatwg.org/multipage/iana.html]

### Pitfall 3: Git Cannot Validate Ignored Generated Outputs

**What goes wrong:** A clean `git diff` is reported as asset freshness even when outputs were absent, stale, or nondeterministic. [VERIFIED: `.gitignore:9-10`;
direct absence probe on 2026-10-05]

**How to avoid:** Clean only the two known outputs, build twice, compare hashes, and separately check tracked worktree state.

### Pitfall 4: Stale Command Names

**What goes wrong:** The locked `deno task check:nix` command fails because current `deno.json` exposes `nix:check`; the analogous update names also differ.
DATA_4B8E1A20_START `"nix:check"` and `"nix:update"` DATA_4B8E1A20_END [VERIFIED: `deno.json:22-23`; conflicting guidance at `AGENTS.md:49-53`]

**How to avoid:** Add compatibility aliases during Wave 0, preserving the existing tasks, then use the locked command names in evidence.

### Pitfall 5: Formatter Sees Orchestrator State

**What goes wrong:** The required root `deno fmt --check` currently fails on untracked `.gsd/dispatch-isolation-sentinel.json`; source formatting is not the
failure. [VERIFIED: command executed 2026-10-05]

**How to avoid:** Treat `.gsd` as generated tool state and ensure the exact repository formatter gate excludes or safely removes it before final evidence. Do
not format/commit unrelated orchestrator state.

### Pitfall 6: Cached Docker Layers Masquerade as Verification

**What goes wrong:** Docker can reuse a cached base and cached `RUN` layers; the Dockerfile's build step might not execute against current inputs. [CITED:
https://docs.docker.com/build/cache/invalidation/]

**How to avoid:** Use `docker build --pull --no-cache --progress=plain`, tag the candidate explicitly, and record `docker image inspect` identity. `--pull`
seeks fresh referenced images and `--no-cache` disables layer-cache reuse. [CITED: https://docs.docker.com/reference/cli/docker/buildx/build/]

### Pitfall 7: Overclaiming Docker Reproducibility

**What goes wrong:** The Dockerfile uses mutable `denoland/deno:debian`, so a fresh build is not byte-for-byte reproducible across time merely because it used
no cache. DATA_8C0D51E4_START `FROM denoland/deno:debian` DATA_8C0D51E4_END [VERIFIED: `Dockerfile:14`]

**How to avoid:** For this phase, record the resolved image ID/digest and exact command; do not widen scope into base-image pinning unless a failure requires
it.

### Pitfall 8: Nix Hash Repair Without Diagnosis

**What goes wrong:** Running the updater first can normalize hashes without proving a mismatch or recording what changed.

**How to avoid:** Run the deterministic checker first. Only on the script's parsed fixed-output mismatch should the updater modify `denoDepsHash` or client
bundle `hash`, after which the complete check must pass. [VERIFIED: `scripts/nix-update-hashes.sh:18-29,31-74`; current attributes at `nix/package.nix:23,42`]

### Pitfall 9: Evidence Collected Across Different Candidate States

**What goes wrong:** Test, Docker, and Nix results no longer describe one candidate if `HEAD` or tracked files change between gates.

**How to avoid:** Record the full SHA before and after every heavyweight gate group; abort/restart the evidence run on a candidate change.

## Code Examples

Verified patterns from official sources and the repository:

### Weak `If-None-Match` Comparison

```typescript
// Source: RFC 9110 sections 8.8.3.2 and 13.1.2
function ifNoneMatchMatches(headerValue: string | undefined, etag: string): boolean {
  if (headerValue === undefined) return false;
  const value = headerValue.trim();
  if (value === "*") return true;

  return value.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === etag;
  });
}
```

This pattern performs weak comparison by comparing opaque quoted tags independent of the optional weak marker; invalid mixed wildcard/list input is not promoted
to a match. [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2] [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2]

### Exact Multipart Active-Content Extension

```typescript
// Source: WHATWG multipart/x-mixed-replace registration and existing normalized classifier
export function isActiveContentMime(value: string | null | undefined): boolean {
  const baseMime = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (
    baseMime === "text/html" ||
    baseMime === "text/xml" ||
    baseMime === "application/xml" ||
    baseMime === "multipart/x-mixed-replace"
  ) {
    return true;
  }

  const slash = baseMime.indexOf("/");
  return slash > 0 && baseMime.slice(slash + 1, -4).length > 0 && baseMime.endsWith("+xml");
}
```

The three existing exact MIME values and `+xml` rule are verbatim from the current classifier; the multipart value is the exact official registered type
identified by the advisory. DATA_2A79C5B6_START `"text/html"`, `"text/xml"`, `"application/xml"`, `"+xml"` DATA_2A79C5B6_END [VERIFIED:
`src/utils/mime.ts:10-18`] [CITED: https://html.spec.whatwg.org/multipage/iana.html]

### Deterministic Generated-Asset Check

```bash
# Record candidate/worktree first. Remove only the two repository-declared generated outputs.
rm -f public/client.js public/styles.css
deno task build
test -s public/client.js
test -s public/styles.css
sha256sum public/client.js public/styles.css > /tmp/blossom-assets-first.sha256

deno task build
sha256sum public/client.js public/styles.css > /tmp/blossom-assets-second.sha256
diff -u /tmp/blossom-assets-first.sha256 /tmp/blossom-assets-second.sha256
git diff --exit-code
```

The output paths and build task are repository-defined. DATA_6C14F982_START `public/client.js`, `public/styles.css`, `build` DATA_6C14F982_END [VERIFIED:
`deno.json:17-21`; `.gitignore:9-10`]

### Fresh Local Docker Gate

```bash
docker build --pull --no-cache --progress=plain -t blossom-server:v6.4.1-rc .
docker image inspect blossom-server:v6.4.1-rc --format '{{json .Id}} {{json .RepoDigests}}'
```

The freshness flags follow Docker's official CLI guidance; the local tag is a recommended evidence label, not a publish action. [CITED:
https://docs.docker.com/reference/cli/docker/buildx/build/]

### Deterministic Nix Gate

```bash
deno task check:nix

# Only if the first command reports a genuine fixed-output hash mismatch:
deno task update:nix-hashes
git diff -- nix/package.nix
deno task check:nix
```

These locked names require the Wave 0 compatibility aliases because the current executable tasks are named differently. [VERIFIED: `AGENTS.md:49-73`;
`deno.json:22-23`; `scripts/nix-check.sh:5-21`; `scripts/nix-update-hashes.sh:70-74`]

## State of the Art

| Old Approach                             | Current Approach                                                          | When Changed                          | Impact                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strong-form-only ETag string stripping   | RFC weak entity-tag comparison for `If-None-Match`                        | Required for Phase 4 advisory closure | Weak and strong validators with the same opaque tag produce the same cache validation result. [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2] |
| HTML/XML-only active classifier          | Add exact `multipart/x-mixed-replace` at the same persisted-MIME boundary | Required for Phase 4 advisory closure | Closes a browser-defined multipart document path that can contain active HTML parts. [CITED: https://html.spec.whatwg.org/multipage/iana.html]                    |
| Cached `nix build` result as confidence  | Realize, force-rebuild fixed/final outputs, then `nix flake check`        | Existing repository script            | Existing store paths cannot alone satisfy the gate. [VERIFIED: `scripts/nix-check.sh:13-21`]                                                                      |
| Worktree diff as asset freshness         | Clean outputs + two builds + hash comparison + tracked diff               | Phase 4 recommendation                | Works even though generated outputs are ignored. [VERIFIED: `.gitignore:9-10`; `deno.json:17-21`]                                                                 |
| Live backend-per-adapter E2E expectation | Real local behavior plus storage contract/type/build review               | Locked Phase 4 scope                  | Preserves deterministic evidence without a disproportionate S3 harness. [VERIFIED: `04-CONTEXT.md`]                                                               |

**Deprecated/outdated:**

- The written Nix task names are not currently executable from `deno.json`; reconcile them before using the locked evidence commands. [VERIFIED:
  `AGENTS.md:49-53`; `deno.json:22-23`]
- A bare `git diff` is insufficient for the two ignored generated outputs. [VERIFIED: `.gitignore:9-10`]

## Project Constraints (from AGENTS.md)

- Use the Deno toolchain; there is no `package.json`. [VERIFIED: `AGENTS.md:15-17`]
- Run `deno fmt` before every commit and require `deno fmt --check`; source should also satisfy 2-space indentation, double quotes, and the documented
  120-character line width. [VERIFIED: `AGENTS.md:61-62,198-202`]
- Add user-facing unreleased changes to `CHANGELOG.md` under the appropriate Unreleased category; advisory fixes change observable HTTP behavior and therefore
  need Patch Changes coverage if not already described adequately. [VERIFIED: `AGENTS.md:64-66`]
- Tests belong in `tests/unit/` for pure logic or `tests/e2e/` for full Hono `app.fetch()` behavior. Use real in-memory/temporary infrastructure, signed Nostr
  events, and worker sanitizer exceptions where applicable. [VERIFIED: `AGENTS.md:68-69,338-365`]
- Preserve the milestone branch/release workflow and contribution traceability; do not tag or publish in Phase 4. [VERIFIED: `AGENTS.md:75-87`;
  `.planning/REQUIREMENTS.md:31-38`]
- Preserve explicit `.ts`/`.tsx` local extensions, `import type` for types, ESM, import-map specifiers, and established naming conventions. [VERIFIED:
  `AGENTS.md:171-225`]
- Keep request rejection streaming-safe: cancel potentially started bodies and never buffer large request bodies. [VERIFIED: `AGENTS.md:300-320,326-334`]
- Preserve explicit auth enforcement per route, no worker-pool queue, YAML+Zod configuration, and S3 local staging before commit. [VERIFIED:
  `AGENTS.md:300-334`]
- Route registration order remains significant; do not move catch-all blob routing ahead of protocol/admin routes. [VERIFIED: `AGENTS.md:166-167`]
- Run the deterministic Nix check after dependency/bundle changes and only refresh hashes after a reported mismatch. [VERIFIED: `AGENTS.md:71-73`]

Two referenced project documents, `TESTING.md` and `ARCHITECTURE.md`, are absent in this checkout despite AGENTS.md naming them. The planner should use
AGENTS.md, existing tests, and prior phase artifacts as the available source of patterns; recreating those broad documents is not necessary for Phase 4.
[VERIFIED: `AGENTS.md:68-69,91-104`; direct `test -e`/read probes on 2026-10-05]

The documented 120-character style is stricter than the current formatter setting of 160; new hand-written code can honor 120 while still passing the repository
formatter. DATA_0E5D71A3_START `"lineWidth": 160` DATA_0E5D71A3_END [VERIFIED: `AGENTS.md:198-202`; `deno.json:37-40`]

## Assumptions Log

| # | Claim                                                                                                                                         | Section | Risk if Wrong |
| - | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------- |
| — | None. Recommendations are based on locked decisions, opened repository sources, executed environment probes, or cited primary standards/docs. | —       | —             |

## Open Questions

1. **How should the locked Nix command names be reconciled?**
   - What we know: AGENTS.md/CONTEXT.md require `check:nix` and `update:nix-hashes`, while `deno.json` exposes `nix:check` and `nix:update`. [VERIFIED:
     `AGENTS.md:49-53`; `deno.json:22-23`]
   - What's unclear: Whether maintainers prefer renaming or compatibility aliases.
   - Recommendation: Add aliases for the locked names and preserve existing names to avoid breaking current local usage.

2. **How should generated `.gsd` state be kept out of the exact formatter gate?**
   - What we know: `deno fmt --check` currently fails only on `.gsd/dispatch-isolation-sentinel.json`; `deno lint` and the full test task pass. [VERIFIED:
     commands executed 2026-10-05]
   - What's unclear: Whether `.gsd` is expected to persist in developer worktrees.
   - Recommendation: Add `.gsd` to the formatter exclude (and ignore list if appropriate) as Wave 0 gate hygiene rather than formatting or committing transient
     state.

3. **Should the evidence artifact be committed in Phase 4 or generated by final verification?**
   - What we know: The user requires retained commands/outcomes/mappings/freshness evidence, and evidence structure is discretionary. [VERIFIED:
     `04-CONTEXT.md`]
   - What's unclear: Exact filename and whether heavy gate logs are summarized or attached.
   - Recommendation: Commit a concise `04-VERIFICATION-EVIDENCE.md` with exact commands/results/identities and reference full logs by stable local path only
     when necessary; do not commit massive logs.

## Environment Availability

| Dependency                  | Required By                              | Available  | Version                          | Fallback                                                                                                                                                           |
| --------------------------- | ---------------------------------------- | ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deno                        | Format, lint, check, tests, asset build  | ✓          | 2.9.5                            | None needed. [VERIFIED: environment probe 2026-10-05]                                                                                                              |
| Docker daemon               | Local image gate                         | ✓          | 29.8.0                           | If daemon becomes unavailable, Phase 4 is incomplete; CI is corroboration, not a substitute for the locked local build. [VERIFIED: `docker info` probe 2026-10-05] |
| Nix                         | Deterministic package gate               | ✓          | 2.34.7                           | None needed. [VERIFIED: environment probe 2026-10-05]                                                                                                              |
| Git                         | Candidate/worktree/traceability evidence | ✓          | 2.53.0                           | None needed. [VERIFIED: environment probe 2026-10-05]                                                                                                              |
| LibSQL native runtime       | E2E metadata fixtures                    | ✓          | Resolved `@libsql/client` 0.17.0 | Existing full suite passed. [VERIFIED: `deno.lock:15-16`; full task executed 2026-10-05]                                                                           |
| Local filesystem temp space | LocalStorage E2E and S3 staging contract | ✓          | Host filesystem                  | Tests clean temporary directories in `finally`. [VERIFIED: `tests/e2e/active-content.test.ts:23-27,139-142`]                                                       |
| S3 service/credentials      | Not required by locked Phase 4 scope     | Not probed | —                                | Contract/type/build compatibility evidence. [VERIFIED: `04-CONTEXT.md`]                                                                                            |

**Missing dependencies with no fallback:** None detected for the locked phase scope. [VERIFIED: environment probes 2026-10-05]

**Missing dependencies with fallback:** Live S3 is intentionally not a dependency; use the locked storage-boundary evidence model. [VERIFIED: `04-CONTEXT.md`]

## Validation Architecture

Nyquist validation is enabled. DATA_5D62A907_START `"nyquist_validation": true` DATA_5D62A907_END [VERIFIED: `.planning/config.json:20-25`]

### Test Framework

| Property                    | Value                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                   | Deno built-in test runner 2.9.5 with `@std/assert` 1.0.19 [VERIFIED: environment probe; `deno.lock:7`]                                                                                                                                                                                                                                             |
| Config file                 | `deno.json`; client sub-suite uses `src/landing/client/deno.json` through the root task. [VERIFIED: `deno.json:12-24`]                                                                                                                                                                                                                             |
| Quick run command           | `deno test -P --env-file=.env tests/unit/mime.test.ts tests/e2e/active-content.test.ts`                                                                                                                                                                                                                                                            |
| Contribution matrix command | `deno test -P --env-file=.env tests/unit/envelope.test.ts tests/unit/blob-path.test.ts tests/unit/url.test.ts tests/unit/auth.test.ts tests/unit/mime.test.ts tests/unit/logger.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts tests/e2e/active-content.test.ts` |
| Full suite command          | `deno task test` DATA_B82013CE_START `"test": "deno test -P --env-file=.env tests/unit/ tests/e2e/ && deno task test:client"` DATA_B82013CE_END [VERIFIED: `deno.json:15-16`]                                                                                                                                                                      |

### Phase Requirements → Test Map

| Req ID  | Behavior                                                                                                  | Test Type               | Automated Command                                                     | File Exists?                                                    |
| ------- | --------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| VERI-01 | Every selected contribution retains a focused regression covering its original failure/security condition | Integration matrix      | Contribution matrix command above plus contribution SHA assertions    | ✅ existing mapping; ❌ two advisory cases are Wave 0           |
| VERI-02 | Format, lint, and full server/client suite pass on one candidate                                          | Quality gate            | `deno fmt --check && deno lint && deno task test`                     | ✅ commands exist; ❌ `.gsd` formatter hygiene must be resolved |
| VERI-03 | Assets, Docker, and Nix are fresh and reproducible enough to audit                                        | Build/package           | two-build asset hash check; fresh Docker build; `deno task check:nix` | ✅ scripts exist; ❌ task aliases/evidence artifact are Wave 0  |
| VERI-04 | Protocol/streaming/auth/header/hash behavior and both storage backends remain compatible                  | E2E + static/type/build | contribution matrix; `deno check --frozen main.ts`; Docker/Nix gates  | ✅ local E2E and interface exist; live S3 correctly omitted     |

### Sampling Rate

- **Per task commit:** Run the smallest affected focused command; for advisory code use
  `deno test -P --env-file=.env tests/unit/mime.test.ts tests/e2e/active-content.test.ts`, then `deno fmt --check` and `deno lint` after gate hygiene is fixed.
- **Per wave merge:** Run the complete contribution matrix plus `deno check --frozen main.ts`.
- **Phase gate:** Record one unchanged candidate SHA and require `deno fmt --check`, `deno lint`, `deno task test`, two-build asset hash equality, a fresh local
  Docker build, and deterministic Nix check to pass before `$gsd-verify-work`.

### Wave 0 Gaps

- [ ] `tests/unit/mime.test.ts` — add exact/mixed-case/parameterized `multipart/x-mixed-replace` active cases and nearby multipart controls.
- [ ] `tests/e2e/active-content.test.ts` — seed multipart content with an HTML part; assert attachment/nosniff across GET, HEAD, range, strong 304, and weak
      304; add weak-list/non-match/wildcard coverage without weakening existing header assertions.
- [ ] `src/routes/blobs.ts` or a nearby pure helper — implement RFC weak comparison without changing ETag emission or 304 projection.
- [ ] `deno.json` — reconcile locked Nix task names and prevent transient `.gsd` state from invalidating the exact formatter gate.
- [ ] `.planning/phases/04-integrated-candidate-verification/04-VERIFICATION-EVIDENCE.md` — create the retained evidence ledger.

### Baseline Results (2026-10-05)

| Gate                          | Result                                             | Interpretation                                                                                                                              |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno fmt --check`            | FAIL: only `.gsd/dispatch-isolation-sentinel.json` | Gate-hygiene gap, not a source/test formatting regression. [VERIFIED: executed command]                                                     |
| `deno lint`                   | PASS, 84 files                                     | Baseline source lint is green. [VERIFIED: executed command]                                                                                 |
| `deno task test`              | PASS, 391 server + 2 client tests                  | Baseline integrated behavior is green before advisory fixes. [VERIFIED: executed command]                                                   |
| `deno check --frozen main.ts` | PASS                                               | Production import graph, including S3 adapter wiring, typechecks against locked dependencies. [VERIFIED: executed command; `main.ts:15-23`] |

## Security Domain

Security enforcement is enabled at ASVS level 1 and blocks on high-severity findings. DATA_1C9F30E7_START `"security_enforcement": true`,
`"security_asvs_level": 1`, `"security_block_on": "high"` DATA_1C9F30E7_END [VERIFIED: `.planning/config.json:38-50`]

### Applicable ASVS Categories

| ASVS Category         | Applies              | Standard Control                                                                                                                                                                                                                                 |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V2 Authentication     | yes, regression only | Preserve real signed BUD-11 event parsing and existing auth tests; no new auth mechanism. [VERIFIED: `AGENTS.md:9-11,361-364`; `tests/unit/auth.test.ts`]                                                                                        |
| V3 Session Management | no                   | Blossom signed-event auth is request scoped in this phase; no session feature is changed. [VERIFIED: phase scope in `04-CONTEXT.md`]                                                                                                             |
| V4 Access Control     | yes                  | Preserve `requireAuth()`/`requireXTag()` behavior and missing/mismatched hash-scope 403 regressions. [VERIFIED: `AGENTS.md:300-305`; contribution review lines 79-101]                                                                           |
| V5 Input Validation   | yes                  | Central MIME normalization, exact blob grammar, strict expiration parsing, conditional-header parsing, and early body cancellation. [VERIFIED: `src/utils/mime.ts:3-18`; `src/routes/blobs.ts:23-27,87-105`; `src/middleware/envelope.ts:26-39`] |
| V6 Cryptography       | yes, regression only | Preserve worker-computed SHA-256 integrity and real Nostr signature verification; do not introduce custom cryptography. [VERIFIED: `main.ts:84-93`; existing upload/auth tests cited in the contribution matrix]                                 |

### Known Threat Patterns for Deno/Hono Blob Delivery

| Pattern                                                         | STRIDE                                          | Standard Mitigation                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored active multipart document executes in application origin | Elevation of Privilege / Information Disclosure | Exact persisted-MIME classification, attachment disposition, `nosniff`, real GET/HEAD/206/304 regression. [CITED: https://html.spec.whatwg.org/multipage/iana.html]                                  |
| Weak validator bypasses conditional cache behavior              | Tampering / Denial of Service                   | RFC weak comparison and strong/weak/list/wildcard/non-match tests. [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2]                                                               |
| Rejected upload body is pulled or buffered                      | Denial of Service                               | Pre-auth envelope middleware cancels PUT body before returning 415; streamed tests assert zero pulls. [VERIFIED: `src/middleware/envelope.ts:26-39`; `tests/e2e/upload.test.ts:343-413`]             |
| Auth event operates on the wrong blob                           | Spoofing / Elevation of Privilege               | Exact required `x` scope and 403 tests for missing/mismatch. [VERIFIED: contribution review lines 79-101]                                                                                            |
| Query secrets enter logs                                        | Information Disclosure                          | One `URL.pathname` reused for both log lines with focused absence assertions. [VERIFIED: `src/middleware/logger.ts:12-29`; `tests/unit/logger.test.ts:5-33`]                                         |
| Stale build cache hides packaging drift                         | Tampering / Repudiation                         | Clean asset hashes, Docker `--pull --no-cache`, Nix `--rebuild`, immutable candidate SHA ledger. [VERIFIED: `scripts/nix-check.sh:13-21`] [CITED: https://docs.docker.com/build/cache/invalidation/] |

## Sources

### Primary (HIGH confidence)

- Repository source-of-truth files opened this session: `deno.json`, `deno.lock`, `Dockerfile`, `flake.nix`, `nix/package.nix`, Nix scripts, storage
  interface/adapters, main/server/blob/MIME/envelope/logger source, and mapped tests.
- Planning source-of-truth files opened this session: Phase 4 CONTEXT, REQUIREMENTS, STATE, contribution review, prior verification/review/security artifacts,
  and AGENTS.md.
- Executed local probes: branch/ancestry/contribution uniqueness, installed tool versions, Docker daemon availability, Deno task inventory, ignore/output state,
  formatter/lint/full test baseline, and frozen `main.ts` typecheck.

### Secondary (MEDIUM confidence)

- https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2 — entity-tag comparison functions.
- https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2 — `If-None-Match` weak comparison, wildcard/list semantics, and 304 behavior.
- https://html.spec.whatwg.org/multipage/iana.html — `multipart/x-mixed-replace` registration and active subresource security implications.
- https://docs.docker.com/reference/cli/docker/buildx/build/ — `--pull`, `--no-cache`, plain progress, and metadata behavior.
- https://docs.docker.com/build/cache/invalidation/ — Docker cache reuse and invalidation behavior.
- https://docs.deno.com/runtime/reference/cli/task/ — task dependencies.
- https://docs.deno.com/examples/dependency_lockfile_tutorial/ — frozen lockfile behavior.
- https://docs.deno.com/examples/deno_github_actions_tutorial/ — formatter/linter/test CI baseline.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — current locked files and installed tools were opened/probed; no dependency changes are recommended.
- Architecture: HIGH — production injection seams, adapters, routes, and real tests were opened directly.
- Advisory fixes: MEDIUM-HIGH — current defects are directly visible in source and prior review; required semantics are supported by primary standards retrieved
  through web search, which the confidence seam classifies as MEDIUM.
- Build/package gates: HIGH for repository behavior, MEDIUM for Docker CLI freshness guidance — scripts/files were opened and Docker guidance is officially
  cited.
- Pitfalls: HIGH — most were reproduced or read directly; external protocol/cache details are explicitly cited.

**Research date:** 2026-10-05

**Valid until:** 2026-10-19 (external Deno/Docker guidance is fast-moving; repository findings remain valid until source changes)
