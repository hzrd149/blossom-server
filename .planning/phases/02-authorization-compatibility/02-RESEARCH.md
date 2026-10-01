# Phase 2: Authorization Compatibility - Research

**Researched:** 2026-10-01
**Domain:** BUD-11 self-contained authorization-token validation and blob-hash scope enforcement
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### BUD-11 hash scoping
- Upload and delete operations that act on a known blob hash require an `x` tag matching that hash.
- Reject missing `x` tags when the operation requires blob-hash scope; open authorization tokens must not authorize those operations.
- With multiple `x` tags, accept the authorization when at least one tag exactly matches the requested lowercase SHA-256 hash.
- Report a missing or mismatched required blob scope as `403 Forbidden` through the existing `HTTPException` path.

### Expiration validation
- Accept only a complete base-10 integer string as an expiration value; do not accept prefixes through permissive `parseInt` behavior.
- Reject malformed and unsafe expiration values with `400 Bad Request`.
- Treat an expiration earlier than the current Unix timestamp as expired.
- Do not impose a maximum future lifetime. Any valid future expiration remains acceptable, including values more than 30 days away.

### Compatibility and regression coverage
- Keep expiration parsing centralized in `parseAuthEvent()`.
- Adapt only PR #62's safe behavior and avoid unrelated authentication refactors.
- Add unit coverage for strict expiration parsing and required `x`-tag enforcement, plus focused protected-route regression tests.
- Preserve current Base64 compatibility, server-tag behavior, signature verification, and unrestricted valid future expirations for existing clients.

### the agent's Discretion
Planning may choose helper names and exact test organization while preserving the decisions above and repository conventions.

### Deferred Ideas (OUT OF SCOPE)

- Any configurable or fixed authorization lifetime policy remains out of scope and requires separate protocol and product design.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTK-04 | Maintainer can integrate the safe parts of PR #62 so required `x` tags and expiration integers are validated without enforcing an undocumented 30-day lifetime. | Adapt the upstream helper changes, but use the locked `403` status for absent or mismatched scope, omit `MAX_AUTH_TTL_SECONDS`, cover unsafe integers, and prove a signed token expiring more than 30 days ahead remains accepted. [VERIFIED: .planning/REQUIREMENTS.md:16-17; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-32] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Use the Deno toolchain; this repository has no `package.json`. Run `deno fmt` before every commit and `deno fmt --check` to verify formatting. [VERIFIED: AGENTS.md:15-17,26-42,61-62]
- Add the user-facing authorization correction to `CHANGELOG.md` under `Unreleased` → `Patch Changes`, crediting the PR #62 contributor as required by phase context. [VERIFIED: AGENTS.md:64-66; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:52-56]
- Keep pure auth/helper tests in `tests/unit/`; use full Hono `app.fetch()` route tests in `tests/e2e/`; generate real signed events with `generateSecretKey` and `finalizeEvent`. [VERIFIED: AGENTS.md:68-69,338-364]
- Preserve strict TypeScript/ESM conventions: explicit `.ts`/`.tsx` local import suffixes, `import type` for type-only imports, bare specifiers from `deno.json`, double quotes, two-space indentation, and `deno fmt` formatting. [VERIFIED: AGENTS.md:171-225]
- Auth parsing is global but authorization remains route-local: every protected operation must explicitly enforce the required verb and scope. [VERIFIED: AGENTS.md:300-305; src/server.ts:47-52]
- On pre-stream route rejection, cancel any upload request body; on post-hash rejection, abort/remove staged data before returning. Never buffer a large body. [VERIFIED: AGENTS.md:306-320,326-334; src/routes/upload.ts:225-247,381-393]
- Preserve route registration order; exact protocol paths remain before the blob catch-all. [VERIFIED: AGENTS.md:166-167; src/routes/blossom-router.ts:54-77]
- Work stays on the `v6.4.1` release-candidate workflow; the contribution integration commit must be non-merge and carry `Contribution-PR: #62`, with its final SHA linked in the contribution review or a Phase 2 continuation record. [VERIFIED: AGENTS.md:75-87; .planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:90-97]
- Nix validation is not phase-local because this phase changes neither Nix inputs, dependencies, nor bundled client code; Phase 4 owns combined artifact verification. [VERIFIED: AGENTS.md:71-73; .planning/STATE.md:83-87]
- Repository note: `AGENTS.md` refers to root `TESTING.md` and `ARCHITECTURE.md`, but neither exists in this checkout; the available mapped substitutes are `.planning/codebase/TESTING.md` and `.planning/codebase/ARCHITECTURE.md`. [VERIFIED: filesystem probe; .planning/codebase/TESTING.md:1-10; .planning/codebase/ARCHITECTURE.md:1-8]
- Repository inconsistency to avoid propagating into the plan: `AGENTS.md` says auth middleware “never throws,” but the current implementation rethrows `HTTPException`; the locked phase context explicitly retains the existing `400` parse-error path. [VERIFIED: AGENTS.md:302-305; src/middleware/auth.ts:152-175; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:47-50]

## Summary

The phase should be a narrow adaptation, not a cherry-pick. Current `parseAuthEvent()` contains the permissive check `parseInt(expiration, 10) < now`; malformed strings can produce `NaN`, and the comparison is then false. Current `requireXTag()` throws only when at least one `x` tag exists and none matches, so a token with zero `x` tags passes. [VERIFIED: src/middleware/auth.ts:95-103,215-225] PR #62 directly addresses both defects, but it also adds a fixed 30-day maximum and returns `400` for a missing `x` tag; both choices conflict with locked Phase 2 decisions. [CITED: https://github.com/hzrd149/blossom-server/pull/62]

The authoritative BUD-11 document requires kind `24242`, a future Unix `expiration`, a matching operation verb, validation of present `server` tags, and at least one matching `x` tag for endpoints marked as hash-scoped. Its endpoint table marks upload, delete, mirror, and media writes/preflights as requiring matching hash scope. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/11.md] The phase boundary is deliberately narrower: change upload/delete behavior, retain current Base64/server/signature behavior, and accept all safe future timestamps even beyond 30 days. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:9,16-32]

The safest implementation is to (1) replace prefix parsing in `parseAuthEvent()` with a whole-string decimal grammar plus `Number.isSafeInteger`, (2) compare the resulting number with `now` using the locked earlier-than rule, (3) make `requireXTag()` reject both absent and mismatched scope through one `403` `HTTPException`, and (4) ensure every protected upload/delete path calls the helper once the actual hash is known. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-32,52-56] Existing unit and E2E files already provide the needed harness; no dependency or framework work is required. [VERIFIED: tests/unit/auth.test.ts:1-49; tests/e2e/upload.test.ts:1-25,80-134; tests/e2e/delete.test.ts:1-25,82-144]

**Primary recommendation:** Adapt only the strict parser and required-scope portions of PR #62, explicitly omit its TTL constant/check, add known-hash preflight enforcement, update affected upload fixtures to include real hashes, and gate completion on focused unit/E2E regressions plus the full Deno suite.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Decode, structurally validate, and verify BUD-11 events | API / Backend middleware | Cryptographic library | `authMiddleware()` invokes `parseAuthEvent()` before protocol routing; signature verification remains delegated to `nostr-tools`. [VERIFIED: src/server.ts:47-52; src/middleware/auth.ts:61-129] |
| Enforce verb and blob-hash scope | API / Backend route layer | Auth helper | Routes know the actual requested/computed hash; `requireAuth()` and `requireXTag()` are the established enforcement seam. [VERIFIED: src/middleware/auth.ts:181-225; src/routes/upload.ts:147-159,225-247,381-393; src/routes/delete.ts:55-67] |
| Protect preflight requests with a declared hash | API / Backend upload route | Auth helper | `HEAD /upload` is implemented by `app.get("/upload")`, reads `X-SHA-256`, and currently calls only `requireAuth()`, so it needs matching-scope enforcement when that known hash is present. [VERIFIED: src/routes/upload.ts:64-86,130-135] |
| Prove parser and helper behavior | Test harness | API / Backend | `tests/unit/auth.test.ts` already creates real signed events and directly exercises `parseAuthEvent()` and `requireXTag()`. [VERIFIED: tests/unit/auth.test.ts:8-49,102-124,261-328] |
| Prove route behavior and non-deletion/non-commit | Test harness | DB / Storage | Upload/delete E2E suites run the real Hono app with real LibSQL/local storage and signed events. [VERIFIED: tests/e2e/upload.test.ts:1-25,90-134; tests/e2e/delete.test.ts:1-25,86-144] |

## Standard Stack

### Core

| Library / Runtime | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| Deno | 2.9.5 available locally | Type checking, test runner, formatter, linter | Repository-native runtime and toolchain; no package-manager change is needed. [VERIFIED: environment probe; AGENTS.md:15-17] |
| Hono | DATA_K7M2Q9VX_START `"@hono/hono": "jsr:@hono/hono@^4.12.7"` DATA_K7M2Q9VX_END | Context, middleware, routes, `HTTPException` | Existing server framework and error path; keep current API boundaries. [VERIFIED: deno.json:41-44; src/middleware/auth.ts:1-2] |
| nostr-tools | DATA_P4D8R1NW_START `"nostr-tools": "npm:nostr-tools@^2.23.3"` DATA_P4D8R1NW_END | Real event signing in tests and signature verification in production | Existing cryptographic implementation; do not replace or hand-roll signature verification. [VERIFIED: deno.json:52-57; src/middleware/auth.ts:4-5,124-127] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@std/encoding` | DATA_Y3F6T8LC_START `"@std/encoding": "jsr:@std/encoding@^1.0.10"` DATA_Y3F6T8LC_END | Base64url decode/encode | Preserve production decode behavior and signed-event test helpers. [VERIFIED: deno.json:47-49; src/middleware/auth.ts:3,69-77; tests/unit/auth.test.ts:9,47-50] |
| `@std/assert` | DATA_H9S2B5QK_START `"@std/assert": "jsr:@std/assert@1"` DATA_H9S2B5QK_END | Status, throw, and value assertions | Extend existing unit/E2E suites. [VERIFIED: deno.json:45; tests/unit/auth.test.ts:8] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline strict validation inside `parseAuthEvent()` | New schema or validation package | Adds dependency and refactor risk for a two-condition validation rule; conflicts with the locked narrow-patch boundary. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:28-32] |
| Existing `requireXTag()` seam | Duplicate route-local tag loops | Risks inconsistent missing/mismatch status and multi-tag semantics; mirror/media already contain separate historical logic but are outside this phase. [VERIFIED: src/middleware/auth.ts:215-225; src/routes/media.ts:470-495; src/routes/mirror.ts:513-539] |

**Installation:** None. This phase installs no external packages and must not modify the import map. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:28-32]

## Package Legitimacy Audit

Not applicable: no package installation or dependency upgrade is recommended. The legitimacy gate is therefore not triggered.

## Architecture Patterns

### System Architecture Diagram

```text
HTTP request
    |
    v
Envelope admission
    |
    v
Global BUD-11 parser (`parseAuthEvent`)
    |-- malformed / unsafe expiration ----------------------> 400
    |-- expired expiration ---------------------------------> 401
    |-- valid signed event ---------------------------------> route
                                                            |
                                      +---------------------+----------------------+
                                      |                                            |
                               Known hash now                              Hash known after stream
                         (DELETE URL, upload header)                          (PUT upload body)
                                      |                                            |
                                      v                                            v
                           `requireAuth(verb)`                         worker computes lowercase hash
                                      |                                            |
                                      v                                            v
                         `requireXTag(auth, hash)` <-------------------------------+
                            |                  |
                   absent/mismatch         any exact match
                         403                    |
                                                v
                                     ownership / storage operation
```

This preserves the current split between global token parsing and route-local authorization while delaying scope enforcement only when the actual upload hash is not yet known. [VERIFIED: src/server.ts:47-52; src/middleware/auth.ts:137-203; src/routes/upload.ts:225-247,351-393; src/routes/delete.ts:55-67]

### Recommended Project Structure

```text
src/
├── middleware/auth.ts           # strict expiration validation + shared x-scope helper
└── routes/upload.ts             # known-hash HEAD/PUT enforcement; existing post-hash PUT path
tests/
├── unit/auth.test.ts            # grammar, safe integer, expiry, long-future, x-scope matrix
└── e2e/
    ├── upload.test.ts           # protected PUT/HEAD regressions + fixture repair
    ├── delete.test.ts           # missing-scope non-deletion regression + fixture repair
    └── list.test.ts             # setup upload fixture repair
CHANGELOG.md                     # credited Unreleased patch note
.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md
                                 # backfill integration SHA or link Phase 2 continuation
```

Every listed path already exists; no new runtime module is needed. [VERIFIED: repository file inventory]

### Pattern 1: Validate Syntax, Numeric Safety, Then Time Semantics

**What:** Treat expiration validation as three ordered checks: whole-string decimal grammar, safe-integer conversion, then comparison against the trusted server clock. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:22-26]

**When to use:** Inside `parseAuthEvent()` immediately after locating the first expiration tag and before verb/server/signature checks, preserving current validation ordering except for the stricter expiration predicate. [VERIFIED: src/middleware/auth.ts:84-127]

Locked values, verbatim: DATA_W6J3N8RF_START “Reject malformed and unsafe expiration values with `400 Bad Request`”; “Treat an expiration earlier than the current Unix timestamp as expired”; “Do not impose a maximum future lifetime.” DATA_W6J3N8RF_END [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:22-26]

```typescript
// Adapted from PR #62, with its fixed digit-count/TTL policy removed.
if (!/^\d+$/.test(expiration)) {
  throw new HTTPException(400, {
    message: "Auth event expiration must be a unix-seconds integer",
  });
}
const expiresAt = Number(expiration);
if (!Number.isSafeInteger(expiresAt)) {
  throw new HTTPException(400, {
    message: "Auth event expiration out of range",
  });
}
if (expiresAt < now) {
  throw new HTTPException(401, { message: "Auth token expired" });
}
// Intentionally no maximum-future-lifetime check.
```

This grammar rejects whitespace, signs, decimals, hexadecimal, exponent notation, suffixes, and non-digits as malformed; `Number.isSafeInteger` rejects the probed unsafe integer conversion. [VERIFIED: Deno 2.9.5 eval probe] The locked earlier-than rule intentionally keeps `< now`; do not silently change it to `<= now`. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:23-26]

### Pattern 2: One Predicate for Required Scope

**What:** A required scope succeeds only if at least one `x` tag value exactly equals the already-normalized lowercase hash. Missing and mismatched sets are the same authorization failure. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-20]

Locked values, verbatim: DATA_C2V7L5MP_START “With multiple `x` tags, accept the authorization when at least one tag exactly matches the requested lowercase SHA-256 hash”; “Report a missing or mismatched required blob scope as `403 Forbidden` through the existing `HTTPException` path.” DATA_C2V7L5MP_END [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:19-20]

```typescript
export function requireXTag(auth: NostrEvent, hash: string): void {
  const matches = auth.tags.some((tag) => tag[0] === "x" && tag[1] === hash);
  if (!matches) {
    throw new HTTPException(403, {
      message: `Auth token does not authorize operation on blob ${hash}`,
    });
  }
}
```

The combined predicate is less error-prone than a special `xTags.length === 0` branch and automatically preserves multiple-tag acceptance. This is an implementation recommendation derived from the locked semantics. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-20]

### Pattern 3: Enforce at the Earliest Point the Actual Hash Is Known

**What:** For DELETE, enforce after URL hash validation and auth verb validation. For protected PUT upload with a valid `X-SHA-256`, enforce before dedup/streaming and cancel the request body on rejection. Without the header, enforce immediately after the worker computes the actual hash and abort the staged write on rejection. For protected HEAD upload, retain the returned auth event and enforce when `X-SHA-256` supplies a known hash. [VERIFIED: src/routes/delete.ts:39-67; src/routes/upload.ts:64-86,225-247,351-393]

**When to use:** Every protected upload/delete branch that has a concrete hash. Anonymous operation behavior when `requireAuth` is false remains unchanged. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-20,28-32]

### Anti-Patterns to Avoid

- **Cherry-picking PR #62 unchanged:** it introduces `MAX_AUTH_TTL_SECONDS` and returns `400` for a missing `x` tag, contrary to locked behavior. [CITED: https://github.com/hzrd149/blossom-server/pull/62]
- **Using `parseInt`, `Number.parseInt`, or `isNaN` as the grammar check:** prefix parsing is the defect; validate the entire string before conversion. [VERIFIED: src/middleware/auth.ts:95-103; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:22-24]
- **Adding a fixed regex digit limit such as PR #62's `{1,12}`:** numeric safety should be expressed by `Number.isSafeInteger`; a digit-count policy is an extra lifetime/range policy not locked by the phase. [CITED: https://github.com/hzrd149/blossom-server/pull/62]
- **Making `x` globally mandatory during parsing:** BUD-11 has endpoints where `x` is optional or not applicable; scope belongs at the route/helper seam with the actual hash. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/11.md]
- **Refactoring mirror/media authorization in this phase:** those routes already implement required post-hash checks separately; the locked boundary is upload/delete plus shared parsing. [VERIFIED: src/routes/mirror.ts:513-539; src/routes/media.ts:470-495; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:9,28-32]
- **Leaving setup uploads unscoped:** tightening `requireXTag()` will cause existing auth-required upload fixtures in delete/list/upload suites to fail before their actual assertion. Compute the body hash and sign it into the fixture. [VERIFIED: tests/e2e/delete.test.ts:65-79,117-134,186-205,221-242; tests/e2e/list.test.ts:32-54,102-118; tests/e2e/upload.test.ts:861-889]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nostr signature verification | Custom Schnorr/secp256k1 verifier | Existing `verifyEvent(auth)` from `nostr-tools/pure` | Signature behavior is explicitly compatibility-locked and already tested. [VERIFIED: src/middleware/auth.ts:124-127; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:28-32] |
| Base64url decoding | Custom alphabet/padding decoder | Existing `decodeBase64Url` plus standard-Base64 fallback | Existing clients depend on both forms; decoding is outside the defect. [VERIFIED: src/middleware/auth.ts:57-77; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:28-32] |
| Route error formatting | Ad hoc `Response` objects | Existing `HTTPException` / `errorResponse` paths | Preserves status and current text response conventions. [VERIFIED: src/middleware/auth.ts:79-127,188-225; src/middleware/errors.ts:4-31] |
| Time or integer library | Duration parser / big-number package | Anchored decimal regex, `Number`, `Number.isSafeInteger`, server `Date.now()` | The accepted type is safe Unix seconds, not arbitrary precision or human duration. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:22-26] |
| Auth mocks | Fake signature result or fabricated context in route tests | Existing real `finalizeEvent()` event builders and `app.fetch()` | Exercises encoding, parsing, signature, verb, scope, and route integration together. [VERIFIED: tests/unit/auth.test.ts:19-50; tests/e2e/upload.test.ts:31-71,153-157] |

**Key insight:** This phase is an authorization-policy correction at existing seams. New abstractions or dependencies increase compatibility risk without improving the two predicates being fixed. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:28-35]

## Common Pitfalls

### Pitfall 1: Importing the Upstream Lifetime Cap

**What goes wrong:** Valid safe expiration timestamps more than 30 days in the future return `400`. [CITED: https://github.com/hzrd149/blossom-server/pull/62]

**Why it happens:** PR #62 couples strict parsing to a product policy constant and upper-bound check. [CITED: https://github.com/hzrd149/blossom-server/pull/62]

**How to avoid:** Do not add `MAX_AUTH_TTL_SECONDS`, a `{1,12}` policy justified as TTL, or any `expiresAt > now + ...` branch. Add both unit and route acceptance coverage beyond 30 days. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:22-32]

**Warning signs:** A new lifetime constant, “too far in the future” error, or test expecting long-future rejection.

### Pitfall 2: Returning 400 for Missing Scope

**What goes wrong:** A structurally valid signed event with insufficient authorization is classified as malformed. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:60-64]

**Why it happens:** The upstream patch distinguishes zero tags (`400`) from nonmatching tags (`403`). [CITED: https://github.com/hzrd149/blossom-server/pull/62]

**How to avoid:** Have `requireXTag()` use a single any-match predicate and throw `403` for both absent and mismatched required scope. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-20]

**Warning signs:** Any missing-`x` test expects `400`, or a helper has separate status codes based on array length.

### Pitfall 3: Fixing PUT but Leaving Known-Hash Preflight Open

**What goes wrong:** Protected `HEAD /upload` accepts a signed open token even when `X-SHA-256` declares the target hash. [VERIFIED: src/routes/upload.ts:64-86,130-135]

**Why it happens:** The preflight route discards `requireAuth()`'s return value and never calls `requireXTag()`. [VERIFIED: src/routes/upload.ts:72-81]

**How to avoid:** Retain the auth event, validate/normalize the supplied hash consistently, and enforce matching scope before dedup or capacity responses when the hash is known. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-20,52-55]

**Warning signs:** PUT tests pass while no protected HEAD test covers missing/mismatched/matching `x` tags.

### Pitfall 4: Breaking Unrelated E2E Setup

**What goes wrong:** Delete/list tests fail during setup because their auth-required seed uploads use open tokens. [VERIFIED: tests/e2e/delete.test.ts:65-79,117-134; tests/e2e/list.test.ts:32-54,102-118]

**Why it happens:** A shared helper semantic change affects every upload call, not only the new regression test.

**How to avoid:** Update all auth-required seed uploads in `delete.test.ts`, `list.test.ts`, and the list-URL case in `upload.test.ts` to compute and sign the actual hash. [CITED: https://github.com/hzrd149/blossom-server/pull/62]

**Warning signs:** Focused auth unit tests pass but upload/delete/list E2E setup assertions fail.

### Pitfall 5: Cleaning Up Too Late or Not at All

**What goes wrong:** Early mismatch leaves a request body active, or post-hash mismatch leaves a temporary file. [VERIFIED: AGENTS.md:306-320,326-334]

**Why it happens:** Scope can be checked both before and after streaming.

**How to avoid:** Preserve the current cleanup split: cancel the request body on early `X-SHA-256` scope rejection; abort staged storage on deferred post-hash rejection. [VERIFIED: src/routes/upload.ts:225-247,381-393]

**Warning signs:** A new return path occurs before the existing `cancel()` or `abortWrite()` calls.

### Pitfall 6: Time-Boundary Flakiness

**What goes wrong:** A test that signs `expiration = now` races into the past before parsing.

**Why it happens:** Test and parser call `Date.now()` separately.

**How to avoid:** Test clearly past values and comfortably future values; verify the locked `< now` implementation by inspection/unit structure rather than a wall-clock equality race. [VERIFIED: tests/unit/auth.test.ts:31-44,114-124; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:25]

## Code Examples

### Unit Matrix for Strict Expiration

```typescript
for (const bad of ["never", "123abc", "1e12", "-5", "+5", "0x10", "1.5", " 123 ", "9007199254740992"]) {
  const event = makeEvent({
    tags: [["t", "upload"], ["expiration", bad]],
  });
  const error = assertThrows(
    () => parseAuthEvent(encodeEvent(event), null),
    HTTPException,
  );
  assertEquals(error.status, 400);
}
```

The malformed/unsafe status is locked as DATA_R8N1F4SZ_START `400 Bad Request` DATA_R8N1F4SZ_END. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:23-24] Keep expired-value coverage separately expecting the existing DATA_T5C9M2QH_START `401` DATA_T5C9M2QH_END path. [VERIFIED: src/middleware/auth.ts:101-103; tests/unit/auth.test.ts:114-124]

### Compatibility Regression for a Long Future Expiration

```typescript
const now = Math.floor(Date.now() / 1000);
const event = makeEvent({
  tags: [["t", "upload"], ["expiration", String(now + 31 * 24 * 60 * 60)]],
});
assertEquals(parseAuthEvent(encodeEvent(event), null).id, event.id);
```

The `31`-day value is a boundary witness, not a new policy: it proves the forbidden 30-day cap is absent. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:26]

### Delete Non-Mutation Regression

```typescript
const noScope = finalizeEvent({
  kind: 24242,
  created_at: now,
  tags: [["t", "delete"], ["expiration", String(now + 600)]],
  content: "Delete blob",
}, sk);

const denied = await app.fetch(new Request(`http://localhost/${targetHash}`, {
  method: "DELETE",
  headers: { Authorization: encodeAuth(noScope) },
}));
assertEquals(denied.status, 403);

const stillPresent = await app.fetch(new Request(`http://localhost/${targetHash}`, { method: "HEAD" }));
assertEquals(stillPresent.status, 200);
```

The expected missing-scope status is locked as DATA_B6W3K9DL_START `403 Forbidden` DATA_B6W3K9DL_END, and the retained blob assertion proves authorization failed before mutation. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:18-20]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Treat `x` as generally optional and enforce only when present | BUD-11 endpoint table explicitly marks PUT/HEAD upload, DELETE, mirror, and PUT/HEAD media as requiring a matching `x` tag | Specification clarification commit dated 2026-02-25 | Plans can map scope requirements per endpoint instead of globally. [CITED: https://github.com/hzrd149/blossom/commit/f82748e03b653415154c5c7ed46186e37a5fc730] |
| Use permissive `parseInt` as both parser and validator | Validate the full decimal string, then convert and enforce safe-integer/time semantics | PR #62 proposed the correction on 2026-09-29 | Prevents malformed strings from becoming unexpired tokens. [CITED: https://github.com/hzrd149/blossom-server/pull/62] |
| PR #62's fixed 30-day maximum | No phase-level maximum; any safe future timestamp is accepted | Locked for v6.4.1 Phase 2 on 2026-10-01 | Preserves compatibility and avoids inventing product policy in a patch release. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:22-32] |

**Deprecated/outdated:**

- The current unit assertion “no x tags → no throw (open auth event)” and E2E assertion “open x-tag returns 201” encode behavior this phase intentionally removes for known-hash protected operations. [VERIFIED: tests/unit/auth.test.ts:261-272; tests/e2e/upload.test.ts:520-540]
- PR #62's `MAX_AUTH_TTL_SECONDS` and missing-scope `400` behavior are rejected adaptations, not implementation targets. [CITED: https://github.com/hzrd149/blossom-server/pull/62]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | None. Implementation choices are constrained by CONTEXT.md, current source, authoritative BUD-11, or existing repository conventions. | — | — |

## Open Questions

1. **Should protected `HEAD /upload` require `X-SHA-256` when absent?**
   - What we know: authoritative BUD-11 marks matching `x` scope required for HEAD upload and identifies `X-SHA-256` as the implied hash. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/11.md]
   - What's unclear: the locked phase wording requires a matching `x` tag when an operation “act[s] on a known blob hash,” but does not explicitly make the header itself mandatory; the current preflight accepts a missing header. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-20; src/routes/upload.ts:83-86,130-135]
   - Recommendation: for this patch phase, enforce `requireXTag()` whenever `X-SHA-256` is present and valid, but do not newly require the header unless the planner receives an explicit scope decision. This satisfies the locked known-hash rule without broadening compatibility risk.

No other planning question is unresolved.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Deno | format, lint, unit/E2E/full test suite | ✓ | 2.9.5 stable | — [VERIFIED: environment probe] |
| Git | contribution traceability and release-candidate commit | ✓ | current checkout on `v6.4.1` | — [VERIFIED: git status probe] |
| `.env` file | commands pass `--env-file=.env` | ✗ | — | Deno emits a warning; focused auth and upload/delete/list tests still pass because these suites do not require values from it. [VERIFIED: focused test probe] |
| External service / database | phase implementation | not required | — | Tests use local temp storage and embedded LibSQL through the existing harness. [VERIFIED: tests/e2e/upload.test.ts:98-129; tests/e2e/delete.test.ts:94-140] |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `.env` is absent, but current focused commands complete with a warning and no failure. [VERIFIED: focused test probe]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Deno built-in test runner 2.9.5 + `@std/assert` [VERIFIED: environment probe; deno.json:12-16,45] |
| Config file | `deno.json` [VERIFIED: deno.json:1-16] |
| Quick unit command | `deno test -P --env-file=.env tests/unit/auth.test.ts` [VERIFIED: baseline probe: 29 passed, 0 failed] |
| Focused phase command | `deno test -P --env-file=.env tests/unit/auth.test.ts tests/e2e/upload.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts` [VERIFIED: existing E2E baseline probe: 48 passed, 0 failed for the three E2E files] |
| Full suite command | `deno task test` [VERIFIED: deno.json:12-16; AGENTS.md:26-27] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTK-04 | Reject non-digit, prefixed/suffixed, signed, decimal, exponent, whitespace, and unsafe expiration strings with 400 | unit | `deno test -P --env-file=.env --filter "parseAuthEvent" tests/unit/auth.test.ts` | ✅ extend existing [VERIFIED: tests/unit/auth.test.ts:101-124] |
| INTK-04 | Reject past expiration through the existing expired path | unit | same | ✅ existing [VERIFIED: tests/unit/auth.test.ts:114-124] |
| INTK-04 | Accept a safe expiration more than 30 days in the future | unit + E2E upload | `deno test -P --env-file=.env --filter "expiration" tests/unit/auth.test.ts tests/e2e/upload.test.ts` | ✅ extend existing |
| INTK-04 | Missing/mismatched required `x` scope returns 403; one of multiple exact matches succeeds | unit | `deno test -P --env-file=.env --filter "requireXTag" tests/unit/auth.test.ts` | ✅ extend/invert existing [VERIFIED: tests/unit/auth.test.ts:261-328] |
| INTK-04 | Protected PUT upload without `x` returns 403 and matching/mismatched scope behaves correctly | E2E | `deno test -P --env-file=.env --filter "PUT /upload" tests/e2e/upload.test.ts` | ✅ extend/invert existing [VERIFIED: tests/e2e/upload.test.ts:520-540,665-715] |
| INTK-04 | Protected HEAD upload with a known hash enforces missing/mismatched/matching `x` scope | E2E | `deno test -P --env-file=.env --filter "HEAD /upload" tests/e2e/upload.test.ts` | ✅ add cases to existing file [VERIFIED: tests/e2e/upload.test.ts:80-134] |
| INTK-04 | Protected DELETE without `x` returns 403 and leaves the blob present; matching scope still deletes | E2E | `deno test -P --env-file=.env --filter "DELETE blob" tests/e2e/delete.test.ts` | ✅ add missing-scope case; success exists [VERIFIED: tests/e2e/delete.test.ts:149-286] |
| INTK-04 | Existing server tags, signature rejection, Base64url decode, standard Base64 compatibility, and verb checks do not regress | unit | `deno test -P --env-file=.env tests/unit/auth.test.ts` | ✅ existing except add explicit standard-Base64 success case [VERIFIED: tests/unit/auth.test.ts:63-99,142-208,210-259,366-382] |
| INTK-04 | All auth-required seed uploads use matching hashes and upload/delete/list suites remain green | integration regression | focused phase command above | ✅ fixture edits in existing files [VERIFIED: tests/e2e/delete.test.ts:65-79,117-134; tests/e2e/list.test.ts:32-54,102-118; tests/e2e/upload.test.ts:861-889] |

### Sampling Rate

- **Per task commit:** Run the smallest relevant filter plus `deno fmt --check` on the changed tree. [VERIFIED: AGENTS.md:35-42,61-62]
- **Per wave merge:** Run the focused phase command across auth/upload/delete/list.
- **Phase gate:** Run `deno fmt`, `deno fmt --check`, `deno lint`, and `deno task test`; all must be green before verification. [VERIFIED: AGENTS.md:26-42,61-62]

### Wave 0 Gaps

None at the framework/file level: all target test files and helpers exist. The implementation plan must add the missing cases listed above and repair seed fixtures in the same wave as the helper tightening. [VERIFIED: repository file inventory; tests/unit/auth.test.ts:1-13; tests/e2e/upload.test.ts:1-25; tests/e2e/delete.test.ts:1-25; tests/e2e/list.test.ts:1-23]

## Security Domain

Security enforcement is enabled at ASVS Level 1 in project configuration. DATA_J4P7V2RX_START `"security_enforcement": true` and `"security_asvs_level": 1` DATA_J4P7V2RX_END. [VERIFIED: .planning/config.json:47-48]

### Applicable ASVS 5.0 Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Validation and Business Logic | yes | Positive whole-string validation and safe-integer/range semantics at the trusted backend layer; ASVS 5.0 L1 requires input used for security decisions to match predefined patterns/ranges. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x11-V2-Validation-and-Business-Logic.md] |
| V6 Authentication | yes | Continue verifying signed BUD-11 events with the existing cryptographic library; do not alter authentication pathways in this phase. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md] |
| V7 Session Management | no | BUD-11 events are request-carried signed authorization tokens; this phase does not create server sessions. [VERIFIED: src/middleware/auth.ts:53-64,137-179] |
| V8 Authorization | yes | Enforce operation and data-item scope in the trusted API layer; ASVS 5.0 L1 calls for function- and data-specific authorization and trusted-layer enforcement. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md] |
| V9 Self-contained Tokens | yes | Verify digital signature, validity time, intended verb, server audience when present, and target blob hash before accepting claims. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x18-V9-Self-contained-Tokens.md] |
| V11 Cryptography | yes, unchanged | Delegate signature verification to `nostr-tools`; no custom cryptography. [VERIFIED: src/middleware/auth.ts:4-5,124-127] |

### Known Threat Patterns for BUD-11 Authorization

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Open `t=delete` token reused against any blob owned by the signer | Elevation of privilege | Require at least one exact matching `x` tag before ownership mutation. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:16-20] |
| `expiration="never"` or another malformed value bypasses an ordered comparison through `NaN` | Spoofing / elevation of privilege | Positive decimal grammar, safe-integer conversion, server-clock expiration check. [VERIFIED: src/middleware/auth.ts:95-103; .planning/phases/02-authorization-compatibility/02-CONTEXT.md:22-26] |
| Valid token scoped to a different hash is replayed against the requested object | Tampering / elevation of privilege | Exact lowercase hash equality with any-match semantics at the route that knows the actual hash. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/11.md] |
| Leaked unscoped server token is replayed across servers | Spoofing | Preserve existing `server`-tag verification; do not weaken or refactor it. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/11.md] |
| Post-hash rejection leaves staged files and enables resource exhaustion | Denial of service | Abort staged writes before returning 403. [VERIFIED: src/routes/upload.ts:381-393] |
| Fixed 30-day cap rejects otherwise valid existing clients | Denial of service / compatibility | No maximum-future branch; regression-test a value beyond 30 days. [VERIFIED: .planning/phases/02-authorization-compatibility/02-CONTEXT.md:22-32] |

## Sources

### Primary (HIGH confidence)

- Repository source of truth: `src/middleware/auth.ts`, `src/routes/upload.ts`, `src/routes/delete.ts`, `src/server.ts`, and existing tests — current behavior and integration seams.
- `.planning/phases/02-authorization-compatibility/02-CONTEXT.md` — locked behavior and scope.
- `.planning/REQUIREMENTS.md` and `.planning/STATE.md` — INTK-04, release scope, and lifetime-cap exclusion.
- `AGENTS.md` and `deno.json` — repository workflow and toolchain.

### Secondary (MEDIUM confidence)

- https://github.com/hzrd149/blossom/blob/master/buds/11.md — authoritative current BUD-11 authorization and endpoint-scope rules.
- https://github.com/hzrd149/blossom-server/pull/62 — upstream contribution intent, patch, and regression approach.
- https://github.com/hzrd149/blossom/commit/f82748e03b653415154c5c7ed46186e37a5fc730 — specification history for endpoint-specific `x` requirements.
- OWASP ASVS 5.0 V2, V6, V8, and V9 official documents — security-control mapping.

### Tertiary (LOW confidence)

- None used for implementation decisions.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — unchanged dependencies and exact import-map versions were read from `deno.json`; local Deno was probed.
- Architecture: HIGH — current middleware/route/helper flows and cleanup paths were read directly from source.
- Protocol behavior: MEDIUM — current authoritative BUD-11 was fetched from the upstream specification; the project context resolves the only compatibility-sensitive policy choice.
- Pitfalls: HIGH — derived from the actual current implementation, upstream PR patch, and baseline test execution.
- Validation: HIGH — target files exist, existing patterns were inspected, and baseline focused tests passed (29 unit; 48 upload/delete/list E2E).

**Research date:** 2026-10-01
**Valid until:** 2026-10-08 (BUD-11 remains marked draft; recheck the authoritative document if planning occurs later.)
