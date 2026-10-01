# Phase 3: Content and Logging Boundaries - Research

**Researched:** 2026-10-01
**Domain:** HTTP response hardening for untrusted active documents and privacy-preserving access logging
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Active MIME boundary

- Normalize stored MIME values by trimming parameters and folding case.
- Treat `text/html`, `text/xml`, `application/xml`, and every subtype ending in `+xml` as active content.
- This classification covers HTML, XHTML, SVG, XSLT, and other XML-derived formats.
- Stored MIME metadata is authoritative. Requested filename extensions are cosmetic and must not influence classification.

### Response header coverage

- Add `Content-Disposition: attachment` only for active content.
- Add `X-Content-Type-Options: nosniff` to every successful blob representation.
- Apply applicable hardening consistently to full GET, HEAD, range `206`, and conditional `304` responses.
- Ordinary media must remain inline and retain existing range and conditional behavior.

### Attachment filenames

- Derive attachment filenames from the normalized content hash plus a safe extension derived from stored MIME metadata.
- Fall back to the bare hash when no safe extension is available.
- Never use the requested cosmetic suffix as filename or security-policy authority.

### Query-free logging

- Log the URL parser's serialized `pathname` in both request and response lines.
- Preserve the percent-encoded pathname form.
- Omit the query component entirely; do not retain parameter names or values.
- Preserve method, status, timing, `X-Reason`, and existing error context.

### Compatibility Constraints

- Do not force ordinary non-active media to download.
- Do not break GET, HEAD, range, or conditional blob retrieval semantics.
- Do not decode or otherwise rewrite logged paths beyond using the serialized pathname.
- Do not allow URL suffixes to override stored blob metadata.
- Keep this phase limited to the accepted PR #63 and PR #64 hardening behavior.

### the agent's Discretion

No separate discretion section was provided in `03-CONTEXT.md`.

### Deferred Ideas (OUT OF SCOPE)

- `robots.txt` crawler support remains captured separately as `SEED-001`; it is not part of Phase 3.
- The Phase 2 filter-safe test-harness and storage/metadata consistency warnings remain outside this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTK-05 | Maintainer can integrate PR #63 so active HTML, SVG, XML, and XSLT content cannot execute in the server's application origin. | Central MIME normalization/classification, a single response-policy builder, an exact `200`/HEAD/`206`/`304` header matrix, and E2E regression coverage. |
| INTK-06 | Maintainer can integrate PR #64 so request logs omit query strings while retaining useful method, path, status, timing, and error information. | Replace manual request-target slicing with `new URL(ctx.req.url).pathname` and verify both paired log lines through a focused middleware test. |
</phase_requirements>

## Summary

Phase 3 should be implemented as two narrow, independently attributable adaptations. PR #63 belongs at the blob response-policy seam: classify the stored MIME value, build one shared header set, and explicitly project the security headers into the current `304` short-circuit. PR #64 belongs entirely in `requestLogger`: parse once with the platform URL implementation and reuse the serialized `pathname` for both log lines. The current route already centralizes GET, HEAD, range, and conditional handling in `src/routes/blobs.ts`, so neither change requires storage, database, route-order, or streaming refactoring. [VERIFIED: `src/routes/blobs.ts:30-131`, `src/middleware/logger.ts:12-29`]

The upstream patches are starting points, not clean cherry-picks. PR #63 uses seven exact MIME matches, a 12-character hash prefix in filenames, and does not propagate the new security fields into the explicit `304` response. The locked local contract instead requires the full normalized hash, all `+xml` subtypes, and coverage on `304`. PR #64 manually truncates at `?`; the locked local contract requires the URL parser's `pathname`. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:14-49`] [CITED: https://github.com/hzrd149/blossom-server/pull/63] [CITED: https://github.com/hzrd149/blossom-server/pull/64]

`Content-Disposition: attachment` is the navigation isolation control: RFC 6266 defines `attachment` as prompting a local save instead of normal media-type processing. `nosniff` is defense in depth; the Fetch Standard's direct blocking algorithm applies to script-like and style destinations, not ordinary document navigation. [CITED: https://www.rfc-editor.org/rfc/rfc6266.html#section-4.2] [CITED: https://fetch.spec.whatwg.org/#x-content-type-options-header]

**Primary recommendation:** Add an exported pure active-MIME predicate in `src/utils/mime.ts`, build security headers once in `src/routes/blobs.ts`, explicitly include them on `304`, and change the logger to `new URL(ctx.req.url).pathname`; prove the behavior with pure MIME tests, a self-contained active-content E2E matrix, and a focused logger middleware test.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Active MIME classification | API / Backend | Database / Storage | The route makes response policy from the metadata record; storage remains byte-only. [VERIFIED: `src/db/blobs.ts:10-17`, `src/routes/blobs.ts:54-78`] |
| Attachment and `nosniff` response policy | API / Backend | Browser / Client | The origin server emits headers; the user agent enforces their semantics. [CITED: https://www.rfc-editor.org/rfc/rfc6266.html#section-4.2] [CITED: https://fetch.spec.whatwg.org/#x-content-type-options-header] |
| Query-free paired access logs | API / Backend middleware | Operations | The global Hono middleware records both request and response lines before downstream route selection. [VERIFIED: `src/server.ts:41-45`, `src/middleware/logger.ts:12-29`] |
| Regression validation | API / Backend test harness | Local storage / LibSQL | Existing E2E tests use `app.fetch()` with real LibSQL and local storage; no network port is required. [VERIFIED: `tests/e2e/blobs.test.ts:119-166`] |

## Standard Stack

### Core

| Library / API | Version | Purpose | Why Standard Here |
|---------------|---------|---------|-------------------|
| Deno Web `URL`, `Request`, `Response`, streams | Deno `2.9.5` in the research environment | Parse the request URL, construct responses, retain streaming bodies | Already the runtime and HTTP primitive layer; no dependency is needed. [VERIFIED: `deno --version` executed 2026-10-01] |
| Hono | `^4.12.7` | Middleware and blob route response construction | Existing app/router framework, quoted import-map value: `"@hono/hono": "jsr:@hono/hono@^4.12.7"`. [VERIFIED: `deno.json:42-44`] |
| `@std/media-types` | `^1.1.0` | MIME-to-extension mapping for storage and attachment filenames | Existing utility dependency, quoted import-map value: `"@std/media-types": "jsr:@std/media-types@^1.1.0"`. [VERIFIED: `deno.json:45-49`, `src/utils/mime.ts:1-17`] |

### Supporting

| Library / API | Version | Purpose | When to Use |
|---------------|---------|---------|-------------|
| `@std/assert` | major `1` | Header, status, body, and log assertions | Unit and E2E tests, quoted import-map value: `"@std/assert": "jsr:@std/assert@1"`. [VERIFIED: `deno.json:45-45`] |
| LibSQL + `LocalStorage` | existing injected adapters | Seed actual blob metadata and bytes for response E2E coverage | Keep the active-content test on the same real `buildApp(...).fetch()` path as existing retrieval tests. [VERIFIED: `tests/e2e/blobs.test.ts:119-166`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `URL.pathname` | Manual truncation at the first `?` from PR #64 | Manual slicing removes a query but does not implement the locked URL-component boundary and retains the current scheme-offset assumption. Use `URL.pathname`. [VERIFIED: `src/middleware/logger.ts:13-16`] |
| Stored MIME classification | Requested cosmetic extension | The Phase 1 parser explicitly accepts cosmetic suffixes such as `.html`; letting them choose policy would make an octet-stream URL or an active blob's appearance override stored metadata. Use `blob.type`. [VERIFIED: `tests/e2e/blobs.test.ts:318-340`, `src/routes/blobs.ts:54-72`] |
| Shared response policy | Branch-specific header literals | Repeating security headers separately in `200`, HEAD, `206`, and `304` is the path most likely to leave one status unprotected. Build once, project deliberately. [VERIFIED: `src/routes/blobs.ts:70-127`] |

**Installation:** None. This phase installs no package and changes no dependency or generated client asset.

## Architecture Patterns

### System Architecture Diagram

```text
GET/HEAD /<hash>[.<cosmetic suffix>]
        |
        v
Phase 1 exact blob-path parser ---> invalid ---> normal 404 fallthrough
        |
        v
DB blob record (hash, stored MIME, size, uploaded)
        |
        +--> normalize/classify stored MIME ---> active? ---> attachment filename from hash + safe MIME extension
        |                                      |
        |                                      +--> ordinary ---> no Content-Disposition
        v
shared representation headers (Content-Type, validators, cache, nosniff, optional attachment)
        |
        +--> matching If-None-Match ---> 304 metadata/security headers, no body
        +--> HEAD --------------------> 200 same headers, no body
        +--> valid Range -------------> 206 same policy + Content-Range, streamed slice
        +--> full GET ----------------> 200 same policy, streamed body

Any request
   |
   v
requestLogger ---> URL parser ---> serialized pathname only
   |                                  |
   +--> "--> METHOD pathname"         +--> query never enters captured log field
   +--> downstream response
   +--> "<-- METHOD pathname status elapsed [X-Reason]"
```

### Component Responsibilities

| Component | Responsibility | Planned Change |
|-----------|----------------|----------------|
| `src/utils/mime.ts` | MIME normalization and safe extension mapping | Add a pure `isActiveContentMime(value)` predicate; keep `mimeToExt()` as the extension authority. |
| `src/routes/blobs.ts` | BUD-01 retrieval and response policy | Add `nosniff`, active-only attachment, and explicit security-header propagation on `304`; do not alter storage reads or range parsing. |
| `src/middleware/logger.ts` | Paired access logs | Replace substring/query slicing with `new URL(ctx.req.url).pathname` once per request. |
| `tests/unit/mime.test.ts` or the existing MIME utility test file | Classifier truth table | Cover case/parameters, exact XML/HTML families, arbitrary `+xml`, and ordinary controls. |
| `tests/e2e/active-content.test.ts` | Real route response matrix | Cover full GET, HEAD, `206`, `304`, safe filename fallback, cosmetic suffix irrelevance, and ordinary inline media. |
| `tests/unit/logger.test.ts` | Logger privacy contract | Capture `console.log` in `try/finally` and assert both lines use the same encoded pathname without query names or values. |

### Pattern 1: Pure MIME policy predicate

**What:** Normalize the stored value to its base MIME essence, then match the locked exact types or a subtype ending in `+xml`. Keep the predicate independent of request URLs. RFC 7303 explicitly standardizes `application/xml`, `text/xml`, and the `+xml` naming convention, and notes that XML documents can carry stylesheet-linking processing instructions. [CITED: https://www.rfc-editor.org/rfc/rfc7303.html#section-4.2]

**When to use:** Once per successful blob metadata lookup, before building headers.

```ts
// Source basis: RFC 7303 §4.2 and locked 03-CONTEXT.md decisions.
export function isActiveContentMime(value: string | null | undefined): boolean {
  const baseMime = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (baseMime === "text/html" || baseMime === "text/xml" || baseMime === "application/xml") return true;

  const slash = baseMime.indexOf("/");
  return slash > 0 && baseMime.slice(slash + 1).endsWith("+xml");
}
```

Do not carry PR #63's finite seven-type allowlist as the classifier. The locked values are quoted verbatim as `text/html`, `text/xml`, `application/xml`, and every subtype ending in `+xml`; `application/xhtml+xml`, `image/svg+xml`, and `application/xslt+xml` therefore match through the suffix rule. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:16-21`]

### Pattern 2: One base header object, one explicit `304` projection

**What:** Add `X-Content-Type-Options` and optional `Content-Disposition` to the shared `headers` object used by `200`, HEAD, and `206`. For the pre-existing `304` branch, copy the two policy headers deliberately alongside its current cache validators because that branch currently constructs a new object. [VERIFIED: `src/routes/blobs.ts:70-127`]

**When to use:** Every successful retrieval path.

```ts
const headers: Record<string, string> = {
  // existing Content-Type, Content-Length, cache, range, and validator fields
  "X-Content-Type-Options": "nosniff",
};

if (isActiveContentMime(blob.type)) {
  const safeExt = /^[a-z0-9]{1,10}$/i.test(ext) ? ext.toLowerCase() : "";
  const attachmentName = `${hash}${safeExt ? `.${safeExt}` : ""}`;
  headers["Content-Disposition"] = `attachment; filename="${attachmentName}"`;
}
```

The filename alphabet is bounded by the already normalized 64-hex hash and a revalidated ASCII alphanumeric extension; this avoids needing `filename*` or escaping untrusted user input. RFC 6266 treats filenames as advisory and warns against trusting path components or unsafe extensions. [CITED: https://www.rfc-editor.org/rfc/rfc6266.html#section-4.3]

### Exact Response Matrix

| Request / result | Active stored MIME | Ordinary stored MIME | Existing semantics to preserve |
|------------------|-------------------|----------------------|--------------------------------|
| Full GET `200` | `nosniff`; `Content-Disposition: attachment; filename="<full-hash>[.<safe-ext>]"`; original stored `Content-Type`; streamed body | `nosniff`; no `Content-Disposition`; streamed body | `Content-Length`, `Accept-Ranges`, one-year immutable cache, ETag, Last-Modified. [VERIFIED: `src/routes/blobs.ts:70-78,123-127`] |
| HEAD `200` | Same headers as active GET; no body | Same headers as ordinary GET; no body | HEAD currently short-circuits before storage read. [VERIFIED: `src/routes/blobs.ts:95-97`] |
| Range GET `206` | Same active policy plus `Content-Range` and slice length | Same ordinary policy plus `Content-Range` and slice length | Native `readRange()` remains preferred; body stays streamed. [VERIFIED: `src/routes/blobs.ts:99-121,177-242`] |
| Matching conditional GET or HEAD `304` | `nosniff`; same active `Content-Disposition`; ETag, Cache-Control, Last-Modified; no body | `nosniff`; no disposition; same cache metadata; no body | Do not add content or `Content-Length`. RFC 9110 says `304` terminates after headers and requires applicable validators/cache fields that a `200` would have sent. [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5] |
| Unsatisfiable range `416` | No new guarantee | No new guarantee | Not a successful blob representation; preserve current `Content-Range: bytes */<size>`. [VERIFIED: `src/routes/blobs.ts:101-107`] |
| Blob/storage miss `404` | No new guarantee | No new guarantee | Preserve current BUD error response and `X-Reason`. [VERIFIED: `src/routes/blobs.ts:54-64`] |

### Pattern 3: Parse once and reuse serialized pathname

**What:** Replace the current manual request-target substring with the URL parser component getter.

```ts
const { method } = ctx.req;
const path = new URL(ctx.req.url).pathname;
```

The WHATWG URL Standard defines the `pathname` getter as the URL path serializer and defines `search` separately as `?` plus the query. This supplies the required component boundary without decoding the pathname in application code. [CITED: https://url.spec.whatwg.org/#dom-url-pathname]

Use exactly the same immutable `path` variable for the request and response lines. The current formats are quoted as ``--> ${method} ${path}`` and ``<-- ${method} ${path} ${status} ${elapsedStr}${reason ? `  ${reason}` : ""}``; preserve those shapes. [VERIFIED: `src/middleware/logger.ts:17-29`]

### Anti-Patterns to Avoid

- **Copying PR #63 unchanged:** It misses arbitrary `+xml`, shortens the hash filename, and its explicit `304` header object omits the new security fields. [CITED: https://github.com/hzrd149/blossom-server/pull/63]
- **Copying PR #64's `indexOf("?")` truncation:** It is narrower than the locked URL parser boundary and leaves the current manual scheme/path split in place. [CITED: https://github.com/hzrd149/blossom-server/pull/64]
- **Using the requested suffix:** `/<hash>.png` must not make stored SVG inline, and `/<hash>.html` must not force stored octet-stream to download. The existing parser intentionally treats suffixes as cosmetic. [VERIFIED: `tests/e2e/blobs.test.ts:318-340`]
- **Adding attachment to all blobs:** This breaks ordinary image/audio/video embedding and violates the compatibility constraint. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:43-49`]
- **Adding only `nosniff`:** The Fetch Standard only directly blocks script-like/style destinations through this header; it is not the navigation isolation mechanism. [CITED: https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-nosniff]
- **Dropping security headers on `304`:** The route's `304` response bypasses the shared headers object today. Tests must exercise this branch explicitly. [VERIFIED: `src/routes/blobs.ts:80-93`]
- **Decoding logger paths:** `decodeURI`, `decodeURIComponent`, or Hono route params would rewrite the observable path. Use the URL parser's serialized `pathname` directly. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:36-48`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query removal | A scanner for `?`, authority offsets, fragments, or encoded delimiters | `new URL(ctx.req.url).pathname` | URL components and serialization already belong to the platform parser. [CITED: https://url.spec.whatwg.org/#dom-url-pathname] |
| MIME-to-extension map | A local table for HTML/XML/SVG/XSLT extensions | Existing `mimeToExt()` backed by `@std/media-types`, then validate its output | The project already uses this mapping for storage identity. [VERIFIED: `src/utils/mime.ts:9-17`, `src/routes/blobs.ts:60-62`] |
| Attachment filename encoding | User-provided names or requested suffix escaping | Full lowercase content hash plus validated ASCII extension | Inputs are deterministic, ASCII, path-free, and do not require extended filename encoding. [CITED: https://www.rfc-editor.org/rfc/rfc6266.html#section-4.3] |
| Browser execution detection | Content sniffing or body inspection | Stored MIME policy + attachment + `nosniff` | Body inspection would add buffering/complexity and is outside accepted PR #63 scope. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:43-49`] |

**Key insight:** This phase is response policy, not content transformation. Classification depends on stored metadata, bodies remain untouched and streamed, and the storage adapters do not change.

## Common Pitfalls

### Pitfall 1: Security headers vanish on `304`

**What goes wrong:** Full GET, HEAD, and `206` inherit the shared header object, but the conditional branch returns a small object constructed inline. [VERIFIED: `src/routes/blobs.ts:80-93,95-127`]

**How to avoid:** Create a small `securityHeaders` projection or conditionally spread `X-Content-Type-Options` and `Content-Disposition` into the `304` object while retaining ETag, Cache-Control, and Last-Modified.

**Warning sign:** Tests pass for normal GET but a matching `If-None-Match` response lacks `nosniff` or active disposition.

### Pitfall 2: Finite MIME allowlist regresses new XML types

**What goes wrong:** The upstream PR's exact list catches its fixtures but misses valid types such as `application/problem+xml`. RFC 7303 defines `+xml` as the generic structured-syntax signal. [CITED: https://www.rfc-editor.org/rfc/rfc7303.html#section-4.2]

**How to avoid:** Test at least one arbitrary `+xml` subtype in addition to XHTML/SVG/XSLT.

**Warning sign:** The classifier contains only a set of seven literal strings.

### Pitfall 3: The cosmetic suffix controls behavior

**What goes wrong:** A malicious active blob requested as `.png` becomes inline, or an ordinary blob requested as `.html` is unnecessarily downloaded.

**How to avoid:** Build both classification and filename extension from `blob.type`/`mimeToExt(blob.type)`, never `ctx.req.param("filename")` beyond extracting the hash. [VERIFIED: `src/routes/blobs.ts:41-60`]

**Warning sign:** Any security branch inspects the requested filename after `extractBlobHash()`.

### Pitfall 4: Tests only assert header presence on `200`

**What goes wrong:** HEAD, range, or cache revalidation silently bypasses the new policy.

**How to avoid:** For one active blob, assert the complete matrix: GET `200`, HEAD `200`, range `206`, conditional `304`; for one ordinary blob, assert `nosniff` and absence of disposition on the same important paths.

**Warning sign:** The E2E test resembles upstream's initial GET-only loop without `Range` or `If-None-Match`.

### Pitfall 5: Logger tests leak or flake through global console replacement

**What goes wrong:** A failed assertion leaves `console.log` replaced, contaminating the remainder of the suite.

**How to avoid:** Restore `console.log` in `finally`, keep the middleware test self-contained, and assert the response line with a timing-tolerant regular expression.

**Warning sign:** Console restoration occurs only after assertions.

### Pitfall 6: Filter-dependent E2E setup

**What goes wrong:** A new test file uses separate setup/teardown tests, so `--filter` can select a case without its fixture. This is a known deferred Phase 2 harness concern and should not be expanded. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:57-60`]

**How to avoid:** Put active-content setup, assertions, and `try/finally` cleanup in one named `Deno.test`; do not introduce another ordered setup/test/teardown chain.

## Code Examples

### Conditional response security projection

```ts
const notModifiedHeaders: Record<string, string> = {
  ETag: headers.ETag,
  "Cache-Control": headers["Cache-Control"],
  "Last-Modified": headers["Last-Modified"],
  "X-Content-Type-Options": headers["X-Content-Type-Options"],
};
const disposition = headers["Content-Disposition"];
if (disposition) notModifiedHeaders["Content-Disposition"] = disposition;

return ctx.body(null, 304, notModifiedHeaders);
```

RFC 9110 requires applicable validators/cache fields on `304` and prohibits response content; carrying the two security metadata fields is the locked local behavior. [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5] [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:23-28`]

### Logger regression shape

```ts
const logs: string[] = [];
const originalLog = console.log;
console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
try {
  const response = await app.request("http://localhost/caf%C3%A9/%2fitem?token=secret", { method: "GET" });
  // assert request line, response line, status, timing shape, and X-Reason
  // assert neither "token" nor "secret" appears in either captured line
  await response.body?.cancel();
} finally {
  console.log = originalLog;
}
```

The URL Standard makes `pathname` and `search` distinct getters, so the expected logged path remains serialized while the query is excluded. [CITED: https://url.spec.whatwg.org/#dom-url-pathname]

## State of the Art

| Old / upstream approach | Required current approach | Impact |
|-------------------------|---------------------------|--------|
| Exact active-type list in PR #63 | Exact HTML/XML bases plus any valid subtype ending `+xml` | Covers registered and future XML-derived media types within locked scope. [CITED: https://www.rfc-editor.org/rfc/rfc7303.html#section-4.2] |
| 12-character hash filename in PR #63 | Full normalized 64-hex content hash plus safe MIME-derived extension | Matches the locked stable filename decision and existing normalized content address. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:30-34`, `src/routes/blobs.ts:23-28`] |
| Shared headers only on full/HEAD/range | Explicit security projection on conditional `304` too | Prevents policy drift across cache revalidation. [VERIFIED: `src/routes/blobs.ts:80-127`] |
| Manual query truncation in PR #64 | Platform URL parser's serialized `pathname` | Implements the locked component boundary and preserves percent-encoded serialization. [CITED: https://url.spec.whatwg.org/#dom-url-pathname] |

**Deprecated/outdated for this phase:** Directly cherry-picking either upstream patch. Both require local adaptation against Phase 1 path parsing and the locked Phase 3 decisions. [VERIFIED: `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:103-138`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | None. Implementation behavior is locked in `03-CONTEXT.md`; repository structure was read directly; HTTP/browser semantics are cited from primary standards. | — | — |

## Open Questions

None blocking. The upstream PR includes a special `text/xsl` literal, but the locked classifier is explicit: the implementation should follow the three exact base types plus the `+xml` subtype rule. `application/xslt+xml` is therefore covered; do not silently expand the agreed classifier during planning. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:16-21`] [CITED: https://github.com/hzrd149/blossom-server/pull/63]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Deno test runner `2.9.5`; `@std/assert` major `1` [VERIFIED: `deno --version`; `deno.json:45-45`] |
| Config file | `deno.json`; test task quoted verbatim: `"test": "deno test -P --env-file=.env tests/unit/ tests/e2e/ && deno task test:client"`. [VERIFIED: `deno.json:12-16`] |
| Quick run command | `deno test -P --env-file=.env tests/unit/mime.test.ts tests/unit/logger.test.ts tests/e2e/active-content.test.ts` |
| Existing retrieval regression | `deno test -P --env-file=.env tests/e2e/blobs.test.ts tests/unit/range.test.ts` |
| Full suite command | `deno task test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTK-05 | MIME normalization and exact/suffix classification | unit | `deno test -P --env-file=.env tests/unit/mime.test.ts` | ❌ Wave 0 |
| INTK-05 | Active response policy on GET, HEAD, `206`, and `304`; full-hash safe filename; cosmetic suffix ignored; ordinary media inline | E2E | `deno test -P --env-file=.env tests/e2e/active-content.test.ts` | ❌ Wave 0 |
| INTK-05 | Existing range/path/retrieval semantics remain green | regression | `deno test -P --env-file=.env tests/e2e/blobs.test.ts tests/unit/range.test.ts` | ✅ |
| INTK-06 | Both log lines omit query and preserve serialized pathname, method, status, timing, and `X-Reason` | unit/integration | `deno test -P --env-file=.env tests/unit/logger.test.ts` | ❌ Wave 0 |

### Focused Test Matrix

| Area | Cases |
|------|-------|
| Classifier true | `text/html`, mixed-case HTML with parameters, `text/xml`, `application/xml`, `image/svg+xml`, `application/xhtml+xml`, `application/xslt+xml`, arbitrary `application/problem+xml` |
| Classifier false | null/empty, `application/octet-stream`, `image/png`, `application/json`, `text/plain`, malformed lookalike `application/xml-extra` |
| Filename | known safe mapping uses full `<hash>.svg`/`.html`; unknown `+xml` mapping falls back to bare full hash; requested `.png`/`.html` suffix does not alter result |
| Response paths | active GET `200`, active HEAD `200`, active range `206`, active conditional `304`; ordinary GET/HEAD/range/conditional remains no-disposition but has `nosniff` |
| Logger | encoded path such as `/caf%C3%A9/%2fitem`; query name/value absent in both lines; response line retains status, tolerant `ms|s` timing, and `X-Reason` |

### Sampling Rate

- **Per PR #63 task commit:** MIME + active-content focused tests, then existing blob/range regressions.
- **Per PR #64 task commit:** logger focused test.
- **Per wave merge:** `deno fmt --check`, `deno lint`, and `deno task test`.
- **Phase gate:** Full suite green before phase verification.

### Wave 0 Gaps

- [ ] `tests/unit/mime.test.ts` — pure active classifier matrix. If the planner prefers extending `tests/unit/envelope.test.ts`, keep the cases clearly separated; the dedicated file is easier to target.
- [ ] `tests/e2e/active-content.test.ts` — self-contained real-app response matrix with in-test setup and `finally` cleanup.
- [ ] `tests/unit/logger.test.ts` — paired-line query privacy coverage.

No framework installation is required. The root `TESTING.md` named by `AGENTS.md` is not present in the current worktree; use the live `tests/unit/` and `tests/e2e/` patterns plus `.planning/codebase/TESTING.md` if broader conventions are needed. [VERIFIED: repository file inventory executed 2026-10-01]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No behavior change | Blob GET remains on its existing `optionalAuth(ctx)` path. [VERIFIED: `src/routes/blobs.ts:48-53`] |
| V3 Session Management | No | No session or cookie changes are in scope. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:43-49`] |
| V4 Access Control | Indirect | Prevent attacker-controlled stored documents from being processed inline in the application origin; do not change route authorization. [VERIFIED: `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:103-118`] |
| V5 Input Validation | Yes | Normalize stored MIME metadata and validate derived filename extensions; never trust the requested suffix. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:16-34`] |
| V6 Cryptography | No | Existing SHA-256 content addressing is consumed, not modified. [VERIFIED: `src/routes/blobs.ts:23-28,76-82`] |
| V7 Error Handling and Logging | Yes | Remove the entire query component while retaining method, pathname, status, timing, and `X-Reason`. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:36-41`] |

### Known Threat Patterns for Deno/Hono Blob Serving

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored active document executes on the application origin | Elevation of Privilege / Spoofing | Active-only attachment plus `nosniff`; classification from stored MIME. [CITED: https://www.rfc-editor.org/rfc/rfc6266.html#section-4.2] [CITED: https://fetch.spec.whatwg.org/#x-content-type-options-header] |
| MIME-sniffing drift for ordinary blobs | Elevation of Privilege | `X-Content-Type-Options: nosniff` on every successful representation. [CITED: https://fetch.spec.whatwg.org/#x-content-type-options-header] |
| Query secrets persisted in access logs | Information Disclosure | Select `URL.pathname`; never put `URL.search` or the full request target in log interpolation. [CITED: https://url.spec.whatwg.org/#dom-url-pathname] |
| Cosmetic extension policy confusion | Tampering / Spoofing | Security and download filename derive solely from stored MIME plus normalized hash. [VERIFIED: `.planning/phases/03-content-and-logging-boundaries/03-CONTEXT.md:16-34`] |
| Cache revalidation drops security metadata | Elevation of Privilege | Explicitly return the policy fields with `304` and test that branch. [CITED: https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5] |

## Project Constraints (from AGENTS.md)

- Use Deno only; there is no `package.json`. Run `deno fmt` before every commit, then `deno fmt --check`, `deno lint`, and proportionate tests. [VERIFIED: `AGENTS.md:15-42,61-69`]
- Add both user-facing fixes under `CHANGELOG.md` → `Unreleased` → `Patch Changes`, with contributor credit, in the same contribution commit. [VERIFIED: `AGENTS.md:64-66`, `CHANGELOG.md:1-13`]
- Work on the `v6.4.1` release-candidate branch, not `master`, and preserve PR-to-release traceability. [VERIFIED: `AGENTS.md:75-87`]
- Preserve explicit `.ts` / `.tsx` local import extensions and use `import type` for type-only imports. [VERIFIED: `AGENTS.md:171-180`]
- Preserve route order: exact Blossom routes and admin routes remain ahead of the blob catch-all. This phase does not add routes. [VERIFIED: `AGENTS.md:166-167`]
- Do not buffer blob bodies. Keep GET/range bodies as Web Streams and leave storage adapters unchanged. [VERIFIED: `AGENTS.md:317-334`, `src/routes/blobs.ts:99-127`]
- Tests belong in `tests/unit/` for pure logic or `tests/e2e/` for full `app.fetch()` flows; worker-pool tests disable resource sanitizers and clean temporary directories. [VERIFIED: `AGENTS.md:338-359`, `tests/e2e/blobs.test.ts:113-166`]
- Nix checks are required only when changing Nix inputs, dependencies, or bundled client code. This phase changes none, so the planner should not add a Phase 3 Nix rebuild gate; Phase 4 owns integrated packaging verification. [VERIFIED: `AGENTS.md:71-73`, `.planning/ROADMAP.md:104-123`]
- The accepted contribution contract requires exactly one non-merge integration commit per PR, each with `Contribution-PR: #63` or `Contribution-PR: #64`, adapted code, focused test, contributor-credited changelog entry, and later SHA/evidence backfill. [VERIFIED: `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:10-19,103-138`]

## PR Adaptation Plan

### PR #63

Retain:

- Active documents receive attachment disposition; ordinary media remains inline.
- Every successful blob response receives `nosniff`.
- Use real-route E2E coverage and retain [@mptfire](https://github.com/mptfire) attribution. [CITED: https://github.com/hzrd149/blossom-server/pull/63]

Revise:

- Move classification to a pure utility and use the locked exact-base plus `+xml` algorithm rather than the finite upstream list.
- Use the full normalized hash rather than `hash.slice(0, 12)`.
- Revalidate the MIME-derived extension and fall back to the bare hash.
- Propagate security metadata into the explicit `304` response.
- Add HEAD, `206`, `304`, parameter/case, arbitrary `+xml`, cosmetic-suffix, and ordinary-control coverage.
- Land as one non-merge commit with trailer `Contribution-PR: #63`, including its credited changelog entry and tests. [VERIFIED: `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:103-121`]

### PR #64

Retain:

- Queries are absent from both request and response access lines.
- Method, path, status, elapsed time, and `X-Reason` remain.
- Log destinations remain operationally access-controlled because paths still contain public hashes/pubkeys. [CITED: https://github.com/hzrd149/blossom-server/pull/64]

Revise:

- Replace manual query truncation with `new URL(ctx.req.url).pathname`.
- Add a focused test covering both lines, percent-encoded pathname preservation, query-name/value absence, status/timing, and `X-Reason`.
- Land as one non-merge commit with trailer `Contribution-PR: #64`, including its credited changelog entry and test. [VERIFIED: `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:123-138`]

## Sources

### Primary (HIGH confidence authority)

- [RFC 9110 §15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5) — `304` metadata and no-content semantics.
- [RFC 6266 §§4.2–4.3](https://www.rfc-editor.org/rfc/rfc6266.html#section-4.2) — attachment and filename semantics.
- [Fetch Standard §3.6](https://fetch.spec.whatwg.org/#x-content-type-options-header) — normative `nosniff` behavior and destination limits.
- [WHATWG URL Standard `pathname`](https://url.spec.whatwg.org/#dom-url-pathname) — serialized pathname and separation from query.
- [RFC 7303 §4.2](https://www.rfc-editor.org/rfc/rfc7303.html#section-4.2) — XML MIME bases and `+xml` structured syntax suffix.
- Repository source and tests cited inline — current implementation, test harness, and exact project constraints.

### Contribution Sources

- [PR #63](https://github.com/hzrd149/blossom-server/pull/63) — original active-content patch and tests.
- [PR #64](https://github.com/hzrd149/blossom-server/pull/64) — original logger query-stripping patch.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependency; versions and tasks read from `deno.json`, runtime probed locally.
- Architecture: HIGH — current route, middleware, storage interface, DB record, and tests inspected directly.
- HTTP/browser semantics: HIGH — primary RFC and WHATWG sources.
- PR adaptation: HIGH — exact upstream metadata/diffs and local contribution record inspected.
- Pitfalls: HIGH — derived from observed branch/header structure and locked response/logging matrix.

**Research date:** 2026-10-01
**Valid until:** 2026-10-31 (stable standards and repository-specific implementation)
