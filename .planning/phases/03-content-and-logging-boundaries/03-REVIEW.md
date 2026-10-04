---
phase: 03-content-and-logging-boundaries
reviewed: 2026-10-04T02:37:40Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/utils/mime.ts
  - src/routes/blobs.ts
  - src/middleware/logger.ts
  - tests/unit/mime.test.ts
  - tests/unit/logger.test.ts
  - tests/e2e/active-content.test.ts
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-10-04T02:37:40Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

The MIME classifier, blob response policy, pathname-only logger, and their focused tests were reviewed at standard depth. The focused 20-test suite passes with the required Deno permissions, and all six files pass `deno lint` and `deno fmt --check`. However, the active-content classifier omits a browser-supported multipart document type that can contain HTML, leaving a same-origin execution path for mirrored or previously persisted blobs. The conditional ETag parser also violates weak-comparison semantics and sends full representations for valid weak validators.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `multipart/x-mixed-replace` blobs remain inline and can carry active HTML parts

**Files:** `src/utils/mime.ts:10-18`, `src/routes/blobs.ts:81-85`
**Issue:** `isActiveContentMime()` recognizes HTML and XML families but returns `false` for `multipart/x-mixed-replace`. The HTML Standard defines this MIME type as a navigable document whose individual parts can be `text/html`, and explicitly calls out the resulting security implications. Because `buildBlobsRouter()` adds `Content-Disposition: attachment` only when this predicate is true, a persisted blob with this type is returned inline from the application origin. Direct upload envelope rejection does not close the path: the mirror pipeline accepts an origin's base `Content-Type` under the default wildcard storage rule and persists it, and existing databases can already contain the value. `X-Content-Type-Options: nosniff` preserves the supplied multipart type; it does not stop the browser's defined multipart document loader. An attacker able to mirror such a response can therefore serve active HTML parts from the Blossom application's origin.

Reference: [HTML Standard document loading](https://html.spec.whatwg.org/multipage/document-lifecycle.html) and [its `multipart/x-mixed-replace` MIME registration](https://html.spec.whatwg.org/multipage/iana.html).

**Fix:** Treat the exact multipart document type as active at the centralized persisted-MIME boundary and add both unit and real-route regressions:

```ts
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

The E2E case should seed a multipart blob with an HTML part, request it through `buildApp()`, and assert attachment disposition on GET, HEAD, range, and conditional responses.

## Warnings

### WR-01: `If-None-Match` rejects valid weak validators

**Files:** `src/routes/blobs.ts:90-103`, `tests/e2e/active-content.test.ts:85-95`
**Issue:** The parser removes surrounding quotes but does not remove the `W/` marker. Consequently, `If-None-Match: W/"<hash>"` never equals the server's hash and returns `200` with the full blob instead of `304`. RFC 9110 section 13.1.2 requires weak comparison for `If-None-Match`; weak and strong tags with the same opaque value must match. The E2E matrix covers only the strong form, so the regression is not detected.

**Fix:** Compare the server's quoted ETag after removing an optional weak marker from each candidate, then add a weak-validator E2E assertion:

```ts
const ifNoneMatch = ctx.req.header("if-none-match");
const etag = `"${hash}"`;
const matches = ifNoneMatch?.trim() === "*" ||
  ifNoneMatch?.split(",").some((candidate) =>
    candidate.trim().replace(/^W\//, "") === etag
  );

if (matches) {
  // Return the existing 304 header projection.
}
```

---

_Reviewed: 2026-10-04T02:37:40Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
