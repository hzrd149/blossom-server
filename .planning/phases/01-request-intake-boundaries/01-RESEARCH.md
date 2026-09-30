# Phase 1: Request Intake Boundaries - Research

**Researched:** 2026-09-30 **Domain:** HTTP request admission, Blossom upload semantics, path grammar, static-file filesystem boundaries, and contribution
traceability **Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

### Envelope rejection surface

- **D-01:** Apply raw-body envelope validation to `PUT /upload`, `HEAD /upload`, `PUT /media`, and `HEAD /media`.
- **D-02:** Run envelope validation before authentication. A request that is both unauthorized and envelope-encoded returns the envelope error.
- **D-03:** Normalize the base MIME type case-insensitively and ignore valid MIME parameters. Reject every `multipart/*` type and
  `application/x-www-form-urlencoded`.
- **D-04:** Return `415 Unsupported Media Type`. `X-Reason` may give ASCII-only, human-readable guidance to send the raw file body, but its exact wording is not
  a machine-readable contract and client software must not depend on it.
- **D-05:** Rejected streaming request bodies must follow the repository's established cancellation semantics and must never be buffered merely to reject them.

### Blob-path grammar and retrieval

- **D-06:** Accept 64-character hexadecimal hashes in either case and normalize them internally.
- **D-07:** After the hash, accept multiple dot-separated extension segments of 1–10 ASCII alphanumeric characters each and allow one trailing slash.
- **D-08:** Reject other suffix text, including quotes, commas, JSON fragments, whitespace, encoded separators, and structurally unsafe content, with the normal
  `404` behavior.
- **D-09:** Extensions are cosmetic. Serve accepted URLs directly using the blob's stored `Content-Type`; never infer response type from the requested suffix,
  redirect for canonicalization, or require the suffix to match stored metadata.

### Static-asset screening

- **D-10:** Allow safe nested paths to reach `serveStatic` so operators can supply nested assets in their own `public` directory.
- **D-11:** Before filesystem access, limit every decoded path segment to 255 characters and the complete decoded path to 2,048 characters.
- **D-12:** Allow ordinary decoded Unicode filenames and spaces. Reject control characters, backslashes, empty or interior dot segments, traversal patterns, and
  unsafe encoded separators.
- **D-13:** A non-candidate bypasses `serveStatic` and continues through normal application routing; unmatched requests receive the application's usual `404`.

### Contribution review and traceability

- **D-14:** Create a dedicated Phase 1 contribution-review document covering PRs #53, #54, #62, #63, and #64.
- **D-15:** Each entry records original intent, affected files and behavior, protocol or security basis, patch-release fit, integrate/revise/defer decision,
  required deviations, regression evidence, and resulting phase and commit linkage.
- **D-16:** Squash each accepted PR into one integration commit on `v6.4.1`.
- **D-17:** Retain the contributor handle and PR number in the review record. Every accepted contribution's pending `CHANGELOG.md` entry must credit its
  contributor so the release notes preserve attribution.

### the agent's Discretion

No implementation decisions were delegated. Planning may choose helper names, module placement, and test organization while preserving the behavior above and
existing repository conventions.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

<!-- End of verbatim CONTEXT.md constraints. -->

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                                                                                           | Research Support                                                                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INTK-01 | Maintainer can review each selected PR against the current codebase, protocol specifications, patch-release scope, and security constraints.                                          | PR evidence and a required review-record schema are documented below. [VERIFIED: .planning/REQUIREMENTS.md:12]                                                                                                                                                                               |
| INTK-02 | Maintainer can integrate PR #53 so multipart and URL-encoded upload envelopes are rejected without buffering rejected bodies.                                                         | Middleware placement, MIME normalization, cancellation, and regression tests are specified below. [VERIFIED: .planning/REQUIREMENTS.md:13]                                                                                                                                                   |
| INTK-03 | Maintainer can integrate PR #54 so malformed blob paths are rejected and do not trigger unnecessary static-file filesystem operations, without rejecting reasonable valid extensions. | A complete blob grammar, pre-filesystem static predicate, and positive/negative test matrix are specified below. [VERIFIED: .planning/REQUIREMENTS.md:14-15]                                                                                                                                 |
| INTK-07 | Maintainer can develop the milestone on `v6.4.1` and merge every selected contribution into that release-candidate branch rather than directly into `master`.                         | The repository is currently on `v6.4.1`; the plan must preserve one squashed integration commit per accepted PR and record the resulting SHA. [VERIFIED: .planning/REQUIREMENTS.md:21-22; AGENTS.md:75-87; local `git branch --show-current` and `git merge-base master v6.4.1`, 2026-09-30] |

</phase_requirements>

## Summary

Phase 1 should be planned as two revised contribution integrations plus a traceability record, not as direct cherry-picks. PR #53 has the right rejection
intent, but its route-local checks cannot meet D-02 because the top-level auth middleware runs first and can throw during Nostr parsing; envelope admission
therefore belongs in narrowly scoped top-level middleware registered before auth. [VERIFIED: src/server.ts:33-44; src/middleware/auth.ts:137-178] PR #54 also
needs adaptation: the current blob matcher accepts a lowercase 64-hex substring anywhere in a path segment, while the locked grammar requires an anchored,
case-insensitive hash plus bounded extension segments and one optional trailing slash. [VERIFIED: src/routes/blobs.ts:23-43;
.planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-35]

Static screening is a separate boundary from blob parsing. The current global `serveStatic` middleware runs for every request before application routes, so
malformed or overlong paths can reach filesystem checks even when the blob router would later return 404. [VERIFIED: src/server.ts:42-67] The screening
predicate must inspect encoded separators before decoding, decode once, enforce segment/path bounds and structural rules, and only then delegate safe candidates
to Hono's static middleware. Hono 4.12.7 checks direct `..` segments, but its Deno adapter performs `lstatSync`/file open operations and logs non-`NotFound`
failures; it does not implement the project's length or full unsafe-separator policy. [CITED:
https://github.com/honojs/hono/blob/v4.12.7/src/middleware/serve-static/index.ts] [CITED:
https://github.com/honojs/hono/blob/v4.12.7/src/adapter/deno/serve-static.ts]

**Primary recommendation:** implement PR #53 as a pre-auth, endpoint-scoped envelope middleware and PR #54 as two pure validators (blob grammar and static
candidacy), with each accepted contribution's code, tests, credited changelog entry, and review linkage landing in one squashed commit on `v6.4.1`.

## Architectural Responsibility Map

| Capability                | Primary Tier                     | Secondary Tier                                 | Rationale                                                                                                                                                                                              |
| ------------------------- | -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Envelope admission        | API / Backend                    | Browser / Client — caller behavior only        | The server decides whether the request representation is acceptable before auth or body processing. [VERIFIED: src/server.ts:33-44; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-25] |
| Blob-path parsing         | API / Backend                    | Database / Storage — lookup after validation   | The router derives a normalized content address before metadata or storage access. [VERIFIED: src/routes/blobs.ts:35-60]                                                                               |
| Static-path candidacy     | API / Backend                    | Database / Storage — local filesystem boundary | The application must decide candidacy before Hono's Deno adapter performs filesystem operations. [VERIFIED: src/server.ts:42-44; src/routes/landing.tsx:17-19]                                         |
| Contribution traceability | Release workflow / Documentation | Git history                                    | Review decisions and integration SHAs connect upstream contributions to the release branch. [VERIFIED: AGENTS.md:75-87; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:43-51]             |

## Project Constraints (from AGENTS.md)

- Use Deno tasks and imports; the repository explicitly says, verbatim, **“All commands use the Deno toolchain. There is no `package.json`.”** [VERIFIED:
  AGENTS.md:15-18]
- Use ESM, explicit `.ts`/`.tsx` local extensions, `import type` for type-only imports, and mapped bare specifiers. [VERIFIED: AGENTS.md:171-195]
- Keep new code within the documented style: **“Line width: 120 characters”**, **“Indentation: 2 spaces (no tabs)”**, and **“Quotes: double quotes”**. The live
  `deno.json` says `"lineWidth": 160`, so AGENTS.md is the governing phase constraint and the mismatch should be corrected or manually respected. [VERIFIED:
  AGENTS.md:198-215; deno.json:37-39]
- Before every commit run `deno fmt`; verify with `deno fmt --check`. Run `deno lint` and `deno task test` at the phase gate. [VERIFIED: AGENTS.md:26-42,61-62]
- Add every accepted user-facing fix to `CHANGELOG.md` under `Unreleased` / `Patch Changes`, crediting the contributor per D-17; do not create a version heading
  in this phase. [VERIFIED: AGENTS.md:64-66; CHANGELOG.md:1-5; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:43-51]
- Keep all selected work on `v6.4.1`, never implement it directly on `master`, and preserve PR-to-commit-to-release traceability. [VERIFIED: AGENTS.md:75-87]
- Preserve route order: named Blossom endpoints precede the blob catch-all, and admin routes precede blob routes. [VERIFIED: AGENTS.md:166-167;
  src/routes/blossom-router.ts:54-77]
- Route rejection uses `return errorResponse(...)`; streaming rejection cancels the body; large bodies use Web Streams and are never buffered. [VERIFIED:
  AGENTS.md:300-320]
- Every route continues to call `requireAuth()` or `optionalAuth()` explicitly after boundary admission. [VERIFIED: AGENTS.md:302-305]
- Place pure tests under `tests/unit/` and full-app tests under `tests/e2e/`; E2E tests call `app.fetch()` without a real HTTP port, use in-memory LibSQL, and
  clean temporary files in `finally`. [VERIFIED: AGENTS.md:68-69,338-365]
- `ARCHITECTURE.md` and `TESTING.md` are named as required reading, but neither file exists in the current checkout; planning must rely on AGENTS.md and
  live-code patterns or add a documentation follow-up. [VERIFIED: AGENTS.md:68-69,91-100; local filesystem check, 2026-09-30]
- This phase does not change JSX, Nix inputs, dependencies, bundled client code, S3 commit behavior, worker queuing, or video optimization; do not broaden it
  into those systems. [VERIFIED: AGENTS.md:71-73,230-298,317-334; .planning/REQUIREMENTS.md:42-56]

## Standard Stack

### Core

| Library / API     | Version                             | Purpose                                                                   | Why Standard                                                                                                                                                                                        |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deno              | 2.9.5 installed                     | Runtime, Request/Response/Web Streams, formatter, linter, and test runner | The repository is Deno-only and its tasks encode the supported commands. [VERIFIED: AGENTS.md:15-59; local `deno --version`, 2026-09-30]                                                            |
| `@hono/hono`      | 4.12.7 locked; published 2026-03-10 | Middleware ordering, routing, `Context`, and Deno `serveStatic`           | The import map requests `^4.12.7` and the lockfile resolves exactly `"jsr:@hono/hono@4.12.7": "4.12.7"`. [VERIFIED: deno.json:40-43; deno.lock:3-7,32-34] [CITED: https://jsr.io/@hono/hono/4.12.7] |
| Web Platform APIs | Deno 2.9.5                          | `Request`, `Headers`, `ReadableStream`, `URL`, and body cancellation      | Existing handlers use request-body cancellation and stream processing directly. [VERIFIED: src/routes/upload.ts:166-206; src/utils/streams.ts:49-77]                                                |

### Supporting

| Library / API               | Version                             | Purpose                                     | When to Use                                                                                                                                                                                |
| --------------------------- | ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@std/assert`               | 1.0.19 locked; published 2026-02-20 | Unit and E2E assertions                     | Use for all added Deno tests; the lockfile resolves exactly `"jsr:@std/assert@1": "1.0.19"`. [VERIFIED: deno.lock:3-7,35-39; AGENTS.md:340-358] [CITED: https://jsr.io/@std/assert/1.0.19] |
| Existing `errorResponse()`  | In-repo                             | Uniform text response and `X-Reason` header | Use for 415 boundary rejection; its status union includes the verbatim value `415`. [VERIFIED: src/middleware/errors.ts:7-30]                                                              |
| Existing Hono `serveStatic` | Hono 4.12.7                         | Serve operator-provided public files        | Invoke only after the application predicate says the path is a safe static candidate. [VERIFIED: src/server.ts:42-44]                                                                      |

### Alternatives Considered

| Instead of                              | Could Use                            | Tradeoff                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-auth top-level middleware           | Checks inside upload/media handlers  | Route-local checks are too late when auth parsing throws before route dispatch, violating D-02. [VERIFIED: src/server.ts:39-44; src/middleware/auth.ts:152-175]                                                     |
| Pure, shared validators                 | Duplicate inline regex/string checks | Duplication makes the four envelope surfaces and GET/HEAD blob behavior easier to diverge. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-42]                                            |
| Wrapping the existing static middleware | Reimplement static file serving      | Hono already handles content retrieval and fallthrough; the missing requirement is admission before its filesystem calls. [CITED: https://github.com/honojs/hono/blob/v4.12.7/src/middleware/serve-static/index.ts] |

**Installation:** None. This phase must use the already locked stack and add no external package. [VERIFIED: deno.json:40-59; .planning/REQUIREMENTS.md:42-56]

## Package Legitimacy Audit

Not applicable: Phase 1 installs no package and introduces no new external dependency. [VERIFIED:
.planning/phases/01-request-intake-boundaries/01-CONTEXT.md:59-77]

## Contribution Review Findings

The required review artifact should be `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md`; the filename is a planning choice, while its
entry fields are locked by D-15. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:43-49]

| PR              | Upstream evidence                                                                                                                                                                                                                                        | Decision for this milestone                                       | Required adaptation                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #53, `@mptfire` | Proposes envelope MIME rejection in upload/media routes with unit coverage; the PR is open and targets an older base. [CITED: https://github.com/hzrd149/blossom-server/pull/53]                                                                         | **Integrate, revised, in Phase 1.**                               | Move admission before top-level auth, cover all four D-01 surfaces, normalize parameters/case, cancel PUT bodies, use ASCII `X-Reason`, and preserve raw-body happy paths. [VERIFIED: src/server.ts:33-44; src/middleware/auth.ts:152-175; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-25] |
| #54, `@mptfire` | Proposes stricter blob/static paths but its patch uses a narrower extension model and includes an unrelated formatting change; the PR is open and currently conflicts with the target branch. [CITED: https://github.com/hzrd149/blossom-server/pull/54] | **Integrate, revised, in Phase 1.**                               | Implement D-06 through D-13 rather than cherry-picking its exact grammar; omit unrelated edits. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-42]                                                                                                                                 |
| #62             | Proposes required `x`-tag and expiration validation, including a fixed 30-day lifetime. [CITED: https://github.com/hzrd149/blossom-server/pull/62]                                                                                                       | **Revise in Phase 2; review only here.**                          | Retain safe validation but remove the undocumented fixed lifetime, as required by INTK-04 and Out of Scope. [VERIFIED: .planning/REQUIREMENTS.md:16-17,53]                                                                                                                                                    |
| #63             | Proposes active-document response hardening. [CITED: https://github.com/hzrd149/blossom-server/pull/63]                                                                                                                                                  | **Defer implementation to Phase 3; record accepted intent here.** | Rebase its blob-response work on the parser resulting from Phase 1. [VERIFIED: .planning/REQUIREMENTS.md:18,68]                                                                                                                                                                                               |
| #64             | Proposes omitting query strings from request logs. [CITED: https://github.com/hzrd149/blossom-server/pull/64]                                                                                                                                            | **Defer implementation to Phase 3; record accepted intent here.** | Keep useful method/path/status/timing/error fields when Phase 3 integrates it. [VERIFIED: .planning/REQUIREMENTS.md:19-20,69]                                                                                                                                                                                 |

Plan PR #53 and #54 as separate integration units. Each unit must finish with one commit containing adapted code, focused tests, a contributor-credited
`Unreleased` patch entry, and its review-record linkage; a final documentation-only update may fill the actual commit SHA and test evidence after the commit
exists. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:43-51; AGENTS.md:64-87]

## Architecture Patterns

### System Architecture Diagram

```text
Incoming Request
      |
      v
method + exact path gate -------------------------------> unrelated route: continue
      |
      v
envelope base-MIME classifier
      | invalid (PUT: cancel body)
      +-------------------------------> 415 + ASCII X-Reason
      |
      v valid
auth parser -> route-level auth enforcement -> upload/media stream pipeline

GET/HEAD request
      |
      +--> static candidate predicate -- unsafe/noncandidate --> normal routing
      |             |
      |             +-- safe --> Hono serveStatic --> file or normal routing
      |
      +--> exact blob-path parser -- invalid --> normal 404
                    |
                    +-- valid --> normalized hash -> DB metadata -> storage stream
                                                          |
                                                          +--> stored Content-Type
```

The diagram separates admission, authentication, filesystem candidacy, and content-address lookup because each has a different trust boundary. [VERIFIED:
src/server.ts:33-67; src/routes/blobs.ts:35-74]

### Recommended Project Structure

```text
src/
├── middleware/
│   └── envelope.ts       # exact endpoint/method admission before auth
├── routes/
│   └── blobs.ts          # route wiring uses exact parser; stored MIME stays authoritative
└── utils/
    ├── mime.ts           # normalized envelope MIME predicate
    └── url.ts            # pure static-candidate predicate
tests/
├── unit/
│   ├── envelope.test.ts
│   ├── blob-path.test.ts
│   └── url.test.ts
└── e2e/
    ├── upload.test.ts
    ├── media.test.ts
    └── blobs.test.ts
```

This placement follows the existing utility, middleware, route, and test boundaries; exact helper names remain planner discretion. [VERIFIED: AGENTS.md:91-164,
338-365; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:53-56]

### Pattern 1: Pre-auth, method-and-path-scoped envelope admission

**What:** register one middleware before `authMiddleware`; it inspects only the exact D-01 method/path pairs. PUT reads `Content-Type`; HEAD preflight reads
`X-Content-Type` first, retaining the route's current `Content-Type` fallback where present. Invalid PUT requests cancel the body and immediately return 415.
[VERIFIED: src/server.ts:33-44; src/routes/upload.ts:83-86,138-206; src/routes/media.ts:219-265,290-368]

**Why:** the comment that auth “never blocks” is contradicted by the current implementation, which rethrows `HTTPException` from `parseAuthEvent`; only
placement before auth guarantees the D-02 precedence for malformed credentials. [VERIFIED: src/middleware/auth.ts:132-178]

```ts
// Project-grounded sketch; exact names are planner discretion.
const ENVELOPE_TARGETS = new Set([
  "HEAD /media",
  "HEAD /upload",
  "PUT /media",
  "PUT /upload",
]);

export function isEnvelopeMime(value: string | undefined): boolean {
  const base = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return base.startsWith("multipart/") || base === "application/x-www-form-urlencoded";
}
```

The exact target values above are quoted from D-01, and the two rejected MIME forms are quoted from D-03. [VERIFIED:
.planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-25]

### Pattern 2: Parse the whole blob segment, then normalize

**What:** use a pure parser that accepts the entire basename only when it is a 64-hex hash followed by zero or more `.` + 1–10 ASCII-alphanumeric segments;
return the hash lowercased. Register both `/:filename` and `/:filename/`, because the pinned Hono router does not make a trailing slash implicit. [VERIFIED:
local Hono 4.12.7 route probe, 2026-09-30; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-35]

```ts
const BLOB_PATH_RE = /^([0-9A-Fa-f]{64})(?:\.[A-Za-z0-9]{1,10})*$/;

export function extractBlobHash(filename: string): string | null {
  return BLOB_PATH_RE.exec(filename)?.[1]?.toLowerCase() ?? null;
}

app.on(["GET", "HEAD"], "/:filename", handler);
app.on(["GET", "HEAD"], "/:filename/", handler);
```

Every grammar value in the sketch—`64`, case-insensitive hexadecimal, segment length `1–10`, multiple dot segments, and one trailing slash—is quoted from D-06
and D-07. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-35]

### Pattern 3: Static candidacy before filesystem middleware

**What:** inspect the still-encoded pathname for separator encodings, decode exactly once with failure-to-noncandidate behavior, then validate decoded structure
and limits. Only call the existing `serveStatic` middleware when the predicate passes; otherwise call `next()` so application routes retain their normal
behavior. [VERIFIED: src/server.ts:42-67; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:37-42]

**Ordering rules:** reject `%2f`/`%5c` and nested `%25...2f`/`%25...5c` forms case-insensitively before decoding; reject malformed percent escapes; then reject
backslashes, C0/C1 controls, DEL, empty interior segments, exact `.`/`..` segments, segment overflow, and whole-path overflow. Allow ordinary Unicode, spaces,
and safe nesting. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:37-42]

Count Unicode code points (`[...text].length`) for the locked word “characters,” not UTF-16 code units. This interpretation is not specified explicitly and must
be confirmed before it becomes a locked implementation decision. [ASSUMED]

### Anti-Patterns to Avoid

- **Route-local envelope checks only:** malformed auth can preempt them, violating D-02. [VERIFIED: src/middleware/auth.ts:152-175]
- **Substring hash matching:** the current `filename.match(/([0-9a-f]{64})/)` accepts unsafe prefix/suffix slop and rejects uppercase hashes. [VERIFIED:
  src/routes/blobs.ts:23-43]
- **Inferring MIME from the requested extension:** retrieval already uses `blob.type`; keep it authoritative. [VERIFIED: src/routes/blobs.ts:51-74]
- **Passing every request to `serveStatic`:** it permits unwanted filesystem work before the blob router can reject malformed paths. [VERIFIED:
  src/server.ts:42-67]
- **Status-only static tests:** a 404 does not prove the filesystem was never attempted; test the pure predicate and add an observable no-filesystem regression
  assertion. [VERIFIED: .planning/REQUIREMENTS.md:14-15]
- **Direct cherry-picks of #53/#54:** both require deviations from locked decisions and the current branch shape. [CITED:
  https://github.com/hzrd149/blossom-server/pull/53] [CITED: https://github.com/hzrd149/blossom-server/pull/54]

## Don't Hand-Roll

| Problem                                   | Don't Build                      | Use Instead                                                 | Why                                                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static file reading/streaming             | A second filesystem server       | Existing Hono `serveStatic` behind a strict predicate       | Hono already handles lookup, response, and fallthrough; this phase adds only the missing admission boundary. [CITED: https://github.com/honojs/hono/blob/v4.12.7/src/middleware/serve-static/index.ts] |
| MIME parsing beyond the needed base token | A complete MIME parser           | Normalize the substring before the first semicolon          | D-03 requires case-insensitive base MIME plus ignored valid parameters, not general multipart parsing. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-25]                   |
| Rejection body handling                   | Buffer/drain the rejected upload | `ReadableStream.cancel()` through the existing request body | Existing rejection semantics explicitly prefer cancellation; drain is reserved for already-decided 2xx paths. [VERIFIED: AGENTS.md:306-320; src/utils/streams.ts:49-77]                                |
| Error response shape                      | Ad hoc `Response` objects        | Existing `errorResponse(ctx, 415, reason)`                  | It already returns text/plain with `X-Reason` and accepts 415. [VERIFIED: src/middleware/errors.ts:7-30]                                                                                               |
| Blob content type selection               | Extension-to-MIME inference      | Stored database `blob.type` with octet-stream fallback      | This preserves D-09 and current retrieval semantics. [VERIFIED: src/routes/blobs.ts:51-74]                                                                                                             |

**Key insight:** the hard part is admission order and proof of non-access/non-buffering, not parsing bytes or serving files; keep validators pure and reuse
existing streaming, error, auth, metadata, and storage paths.

## Common Pitfalls

### Pitfall 1: “Before route auth” is not the same as “before authentication”

**What goes wrong:** a handler-level check still loses to the global auth parser. [VERIFIED: src/server.ts:39-44]

**Why it happens:** `authMiddleware` rethrows protocol parse failures even though its comments call it parse-only. [VERIFIED: src/middleware/auth.ts:132-175]

**How to avoid:** register the envelope gate before auth at the top app and assert an invalid envelope plus invalid/absent auth returns 415. [VERIFIED:
.planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-25]

**Warning sign:** tests cover unauthorized envelope requests but not malformed `Authorization` headers.

### Pitfall 2: Rejection proves a status but not cancellation

**What goes wrong:** a test observes 415 but the implementation buffered or left the streaming body active. [VERIFIED: AGENTS.md:306-320]

**How to avoid:** supply an instrumented `ReadableStream` whose `cancel()` records invocation and whose pull/consumption would fail the test. Assert PUT
rejection cancels without reading. HEAD has no upload body to cancel. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-25]

### Pitfall 3: Encoded path validation occurs after destructive normalization

**What goes wrong:** encoded separators or dot patterns are transformed before the validator can distinguish them. Local probes show direct `%5C` becomes `\` in
Hono's request path, while Hono's static middleware applies its own URI decoding. [VERIFIED: local Hono 4.12.7 path probe, 2026-09-30]

**How to avoid:** inspect `new URL(request.url).pathname` for forbidden encoded separators first, then decode once and validate the decoded form before invoking
`serveStatic`. Test upper/lowercase and double-encoded separator forms. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:37-42]

### Pitfall 4: A 404 test silently permits filesystem access and warnings

**What goes wrong:** both a rejected candidate and a failed filesystem lookup end as 404, so status alone misses INTK-03's non-access requirement. [VERIFIED:
.planning/REQUIREMENTS.md:14-15]

**How to avoid:** unit-test the candidate predicate and add an integration seam that spies on static middleware invocation or captures the Deno adapter's
non-NotFound warning path for an overlong name. [CITED: https://github.com/honojs/hono/blob/v4.12.7/src/adapter/deno/serve-static.ts]

### Pitfall 5: Header text is not ASCII-safe

**What goes wrong:** Deno rejects non-ByteString header values; a typographic em dash in `X-Reason` throws instead of returning 415. [VERIFIED: local Deno 2.9.5
`new Headers()` probe with an em dash, 2026-09-30]

**How to avoid:** keep reason text ASCII and test construction of the actual response header. [VERIFIED:
.planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-25]

### Pitfall 6: Splitting accepted PR work across commits breaks D-16

**What goes wrong:** implementation, tests, or changelog land as separate commits, so the accepted contribution is no longer one squashed integration unit.
[VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:43-51]

**How to avoid:** make each accepted PR a plan/execution unit with all code, tests, changelog, and attribution staged together; fill final SHA linkage after
commit.

## Code Examples

### Envelope middleware placement

```ts
// Source: project middleware order and D-01 through D-05.
app.use("*", requestLogger);
app.use("*", corsMiddleware);
app.use("*", envelopeAdmissionMiddleware);
app.use("*", authMiddleware(config.publicDomain));
```

The exact ordering quotes existing `requestLogger`, `corsMiddleware`, and `authMiddleware(config.publicDomain)` registrations; only the new gate is inserted
between CORS and auth. [VERIFIED: src/server.ts:33-44]

### Blob handler routing

```ts
// Source: D-06 through D-09 and existing stored-MIME retrieval.
const handler = async (ctx: Context, next: Next) => {
  const hash = extractBlobHash(ctx.req.param("filename") ?? "");
  if (!hash) return next();
  // Existing DB/storage flow follows and uses blob.type, not requested suffix.
};
app.on(["GET", "HEAD"], "/:filename", handler);
app.on(["GET", "HEAD"], "/:filename/", handler);
```

The methods `"GET"` and `"HEAD"` and paths `"/:filename"` and `"/:filename/"` are the exact route surface required to preserve current retrieval plus D-07's one
trailing slash. [VERIFIED: src/routes/blobs.ts:32-43; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-35]

### Static wrapper shape

```ts
const staticFiles = serveStatic({ root: PUBLIC_DIR });

app.use("*", async (ctx, next) => {
  if (!isStaticCandidate(new URL(ctx.req.url).pathname)) return next();
  return staticFiles(ctx, next);
});
```

`PUBLIC_DIR` is defined verbatim as `fromFileUrl(new URL("../../public", import.meta.url))`. [VERIFIED: src/routes/landing.tsx:10-19] The wrapper preserves D-13
fallthrough while preventing Hono's filesystem adapter from running for noncandidates. [VERIFIED:
.planning/phases/01-request-intake-boundaries/01-CONTEXT.md:37-42]

## State of the Art

| Old / current approach                         | Required Phase 1 approach                                                       | When changed                | Impact                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route-local envelope checks proposed by PR #53 | Pre-auth, exact-surface admission middleware                                    | Phase 1 decision D-02       | Guarantees envelope errors win over authorization and no upload pipeline sees wrapper bytes. [CITED: https://github.com/hzrd149/blossom-server/pull/53]                                                       |
| Lowercase substring blob match                 | Anchored whole-segment grammar, case normalization, cosmetic bounded extensions | Phase 1 decisions D-06–D-09 | Rejects slop without breaking reasonable extension-bearing URLs. [VERIFIED: src/routes/blobs.ts:23-43; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-35]                                     |
| Global unconditional `serveStatic`             | Candidate-gated `serveStatic`                                                   | Phase 1 decisions D-10–D-13 | Prevents malformed/overlong paths from reaching filesystem APIs and preserves safe nested operator assets. [VERIFIED: src/server.ts:42-44; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:37-42] |

**Deprecated/outdated for this phase:** do not migrate from the pinned Hono 4.12.7 Deno adapter import while implementing the patch. Current Hono documentation
describes Deno support, but dependency migration is separate from the locked contribution scope. [CITED: https://hono.dev/docs/getting-started/deno] [VERIFIED:
deno.lock:3-7,32-34; .planning/REQUIREMENTS.md:42-56]

## Assumptions Log

| #  | Claim                                                                                                             | Section                                  | Risk if Wrong                                                                                       |
| -- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A1 | “Characters” in D-11 means Unicode code points rather than JavaScript UTF-16 code units or UTF-8 bytes. [ASSUMED] | Architecture Patterns / Static candidacy | Boundary tests for non-BMP filenames could differ; confirm before locking exact counting semantics. |

## Open Questions

1. **How should D-11 count Unicode characters?**
   - What we know: ordinary decoded Unicode must be allowed, each segment is capped at 255 characters, and the full decoded path at 2,048 characters. [VERIFIED:
     .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:37-42]
   - What's unclear: the decision does not define code points, UTF-16 code units, or UTF-8 bytes.
   - Recommendation: use Unicode code points and add a discuss/plan confirmation checkpoint because this is the only remaining semantic assumption. [ASSUMED]

2. **Where are the referenced architecture and testing documents?**
   - What we know: AGENTS.md requires `ARCHITECTURE.md` and `TESTING.md`, but both are absent from this checkout. [VERIFIED: AGENTS.md:68-69,91-100; local
     filesystem check, 2026-09-30]
   - What's unclear: whether they were omitted intentionally or should be restored before implementation.
   - Recommendation: do not block Phase 1; use the explicit AGENTS.md rules and live test patterns, and record the documentation gap.

## Environment Availability

| Dependency | Required By                                                             | Available | Version | Fallback                                                                                                                       |
| ---------- | ----------------------------------------------------------------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Deno       | Build, format, lint, tests                                              | ✓         | 2.9.5   | None needed. [VERIFIED: local `deno --version`, 2026-09-30]                                                                    |
| Git        | Branch/commit traceability                                              | ✓         | 2.53.0  | None needed. [VERIFIED: local `git --version`, 2026-09-30]                                                                     |
| GitHub CLI | PR metadata/diff review                                                 | ✓         | 2.100.0 | Use cited GitHub PR pages or REST API. [VERIFIED: local `gh --version`, 2026-09-30]                                            |
| Nix        | Not required by Phase 1 files; available for later release verification | ✓         | 2.34.7  | Phase 4 owns deterministic artifact validation. [VERIFIED: local `nix --version`, 2026-09-30; .planning/REQUIREMENTS.md:28,73] |

**Missing dependencies with no fallback:** none. [VERIFIED: local environment probes, 2026-09-30]

**Execution caveat:** LibSQL tests failed inside the restricted tool sandbox because its native loader attempted `networkInterfaces`; the same focused and full
commands passed outside that sandbox. Execute phase tests with the repository's normal Deno permissions/outside the restricted tool sandbox. [VERIFIED: local
test runs, 2026-09-30]

## Validation Architecture

### Test Framework

| Property           | Value                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework          | Deno built-in test runner 2.9.5 + `@std/assert` 1.0.19. [VERIFIED: deno.json:12-16; deno.lock:3-7,35-39; local `deno --version`, 2026-09-30]                                                                                   |
| Config file        | `deno.json`; its test task is verbatim `deno test -P --env-file=.env tests/unit/ tests/e2e/ && deno task test:client`. [VERIFIED: deno.json:12-16]                                                                             |
| Quick run command  | `deno test -A tests/unit/url.test.ts tests/unit/envelope.test.ts tests/unit/blob-path.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts` [VERIFIED: AGENTS.md:26-33; proposed files are Wave 0] |
| Full suite command | `deno task test` [VERIFIED: AGENTS.md:26-27; deno.json:12-16]                                                                                                                                                                  |

Baseline evidence: the existing focused suites (`tests/unit/url.test.ts`, `tests/e2e/upload.test.ts`, `tests/e2e/media.test.ts`, and `tests/e2e/blobs.test.ts`)
passed **71 tests, 0 failures**; the full suite passed **275 server tests plus 2 client tests, 0 failures** outside the restricted sandbox on 2026-09-30.
[VERIFIED: local test runs, 2026-09-30]

### Phase Requirements → Test Map

| Req ID  | Behavior                                                                                                                                                                             | Test Type                  | Automated Command                                                                                                            | File Exists?                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| INTK-01 | Every selected PR has the D-15 review fields and an integrate/revise/defer disposition                                                                                               | Documentation/schema check | `rg -n -e '#53' -e '#54' -e '#62' -e '#63' -e '#64' .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` | ❌ Wave 0 [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:43-51]                   |
| INTK-02 | All four exact surfaces reject case/parameter variants of `multipart/*` and urlencoded; PUT cancels without pulling; invalid auth still yields 415; raw bodies retain prior behavior | Unit + E2E                 | `deno test -A tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts`                                  | Unit ❌ Wave 0; E2E ✅ extend [VERIFIED: tests/e2e/upload.test.ts:1-25; tests/e2e/media.test.ts:1-31]     |
| INTK-03 | Exact blob grammar, uppercase normalization, cosmetic suffix MIME, one trailing slash, unsafe path rejection, safe nested static path, and proof of no static invocation             | Unit + E2E                 | `deno test -A tests/unit/blob-path.test.ts tests/unit/url.test.ts tests/e2e/blobs.test.ts`                                   | Parser ❌ Wave 0; URL/E2E ✅ extend [VERIFIED: tests/unit/url.test.ts:1-14; tests/e2e/blobs.test.ts:1-25] |
| INTK-07 | Work and integration commits are on `v6.4.1`, not `master`                                                                                                                           | Git assertion              | `test "$(git branch --show-current)" = "v6.4.1" && git merge-base --is-ancestor master HEAD`                                 | Manual gate [VERIFIED: AGENTS.md:75-87]                                                                   |

### Required Test Matrix

- Envelope positives: absent header/default raw body, `application/octet-stream`, and a normal image MIME continue to existing auth/storage behavior. [VERIFIED:
  src/routes/upload.ts:196-204; src/routes/media.ts:359-366]
- Envelope negatives: mixed-case multipart subtype, multipart with parameters, and mixed-case urlencoded with parameters on all four D-01 method/path pairs; PUT
  asserts cancellation and no pull/storage/worker dispatch. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-25]
- Blob positives: lowercase and uppercase bare hashes; multiple extension segments; 1- and 10-character segments; one trailing slash; requested suffix mismatch
  still returns stored `Content-Type`. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-35; src/routes/blobs.ts:51-74]
- Blob negatives: 63/65 hex, 11-character segment, trailing dot, double slash, two trailing slashes, quote, comma, JSON fragment, whitespace,
  direct/double-encoded slash or backslash; all take normal 404 behavior. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-42]
- Static positives: nested paths, decoded spaces, and ordinary Unicode reach static handling; static negatives exercise malformed encoding, controls,
  backslashes, empty/interior dot segments, traversal, encoded separators, segment 256, and decoded path 2,049. [VERIFIED:
  .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:37-42]

### Sampling Rate

- **Per task commit:** run the focused command for the contribution, then `deno fmt`, `deno fmt --check`, and `deno lint`. [VERIFIED: AGENTS.md:26-42,61-62]
- **Per wave merge:** `deno task test`. [VERIFIED: AGENTS.md:26-27]
- **Phase gate:** full suite green, branch assertion green, review record contains final SHAs/evidence, and no implementation commit exists only on `master`.
  [VERIFIED: AGENTS.md:75-87; .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:43-51]

### Wave 0 Gaps

- [ ] `tests/unit/envelope.test.ts` — base MIME normalization and full negative/positive matrix.
- [ ] `tests/unit/blob-path.test.ts` — exact D-06/D-07 grammar and normalization.
- [ ] Extend `tests/unit/url.test.ts` — decoded/encoded static candidacy boundaries.
- [ ] Extend upload/media/blob E2E files — middleware order, cancellation/no-processing, stored MIME, and routing behavior.
- [ ] `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md` — review schema and upstream decisions.

No framework installation or new test configuration is needed. [VERIFIED: deno.json:12-16,40-59]

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies                 | Standard Control                                                                                                                                                                                                               |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V2 Authentication     | yes, ordering-sensitive | Envelope admission precedes parsing, but every valid request continues to existing BUD-11 parse and explicit route enforcement. [VERIFIED: src/server.ts:39-44; AGENTS.md:302-305]                                             |
| V3 Session Management | no                      | This server uses signed request events, and Phase 1 introduces no session state. [VERIFIED: AGENTS.md:9-11; .planning/REQUIREMENTS.md:12-22]                                                                                   |
| V4 Access Control     | yes                     | Admission must not become an auth bypass: only invalid envelopes short-circuit; valid bodies continue to `requireAuth()`/`optionalAuth()`. [VERIFIED: src/routes/upload.ts:67-81,138-159; src/routes/media.ts:221-239,290-321] |
| V5 Input Validation   | yes                     | Exact method/path gate, normalized MIME classifier, anchored blob grammar, and decoded static predicate. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:15-42]                                         |
| V6 Cryptography       | no new control          | Preserve existing SHA-256 content addressing and Nostr verification; this phase adds no cryptography. [VERIFIED: AGENTS.md:9-11; src/routes/blobs.ts:51-79]                                                                    |

### Known Threat Patterns for Deno/Hono request intake

| Pattern                                          | STRIDE                                     | Standard Mitigation                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrapper bytes accepted as a blob                 | Tampering / Integrity                      | Reject multipart and urlencoded envelopes before auth/body processing; hash only raw accepted bytes. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/02.md]                      |
| Overlong/malformed path reaches filesystem       | Denial of Service / Information Disclosure | Candidate predicate with encoded-separator, structural, segment, and total-length bounds before `serveStatic`. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:37-42] |
| Blob path suffix smuggles unrelated content      | Tampering                                  | Anchored whole-segment parser and normal 404 fallthrough. [VERIFIED: .planning/phases/01-request-intake-boundaries/01-CONTEXT.md:27-35]                                                      |
| Pre-auth validation accidentally admits requests | Elevation of Privilege                     | Middleware returns only for invalid envelope; otherwise `await next()` and preserve explicit route auth. [VERIFIED: AGENTS.md:302-305]                                                       |
| Requested extension changes executable type      | Spoofing / XSS precursor                   | Ignore cosmetic suffix and serve stored `Content-Type`. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/01.md]                                                                   |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/01-request-intake-boundaries/01-CONTEXT.md` — locked request-envelope, blob grammar, static screening, and traceability decisions.
- `.planning/REQUIREMENTS.md` — exact INTK-01, INTK-02, INTK-03, and INTK-07 requirements and later-phase boundaries.
- `AGENTS.md` — mandatory repository, testing, changelog, and release workflow constraints.
- `src/server.ts`, `src/middleware/auth.ts`, `src/routes/upload.ts`, `src/routes/media.ts`, `src/routes/blobs.ts`, `src/middleware/errors.ts`, and
  `src/utils/streams.ts` — live execution order and implementation behavior.
- [BUD-01](https://github.com/hzrd149/blossom/blob/master/buds/01.md) — blob retrieval path and stored response MIME behavior.
- [BUD-02](https://github.com/hzrd149/blossom/blob/master/buds/02.md) — raw upload bytes, content headers, 415 behavior, and human-oriented `X-Reason`.
- [BUD-05](https://github.com/hzrd149/blossom/blob/master/buds/05.md) — media endpoint semantics.
- [BUD-06](https://github.com/hzrd149/blossom/blob/master/buds/06.md) — upload HEAD preflight headers and response behavior.
- [Hono 4.12.7 static middleware source](https://github.com/honojs/hono/blob/v4.12.7/src/middleware/serve-static/index.ts) — decode, traversal, lookup, and
  fallthrough behavior.
- [Hono 4.12.7 Deno adapter source](https://github.com/honojs/hono/blob/v4.12.7/src/adapter/deno/serve-static.ts) — filesystem calls and warning behavior.
- PRs [#53](https://github.com/hzrd149/blossom-server/pull/53), [#54](https://github.com/hzrd149/blossom-server/pull/54),
  [#62](https://github.com/hzrd149/blossom-server/pull/62), [#63](https://github.com/hzrd149/blossom-server/pull/63), and
  [#64](https://github.com/hzrd149/blossom-server/pull/64) — contribution intent and current patch evidence.

### Secondary (MEDIUM confidence)

- [Hono Deno documentation](https://hono.dev/docs/getting-started/deno) — current framework setup guidance.
- Local Deno/Hono probes on 2026-09-30 — trailing-slash routing, encoded-path handling, ASCII header enforcement, tool availability, and test baselines.

### Tertiary (LOW confidence)

- Unicode code-point interpretation of D-11 only; explicitly logged as A1 and requires confirmation.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — versions read from the lockfile and local runtime; no dependency changes proposed.
- Architecture: HIGH — middleware and route order verified from live source, with Hono adapter behavior checked against the pinned upstream tag.
- Pitfalls: HIGH — derived from the live execution path, upstream contribution diffs, official Blossom specifications, and local probes.
- Unicode length semantics: LOW — locked wording says “characters” but does not define the counting model.

**Research date:** 2026-09-30 **Valid until:** 2026-10-07 because PR state and branch history are fast-moving; the pinned source analysis remains valid until
those inputs change.
