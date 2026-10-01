# Phase 1 Contribution Review

**Milestone:** v6.4.1\
**Review scope:** PRs #53, #54, #62, #63, and #64\
**Contributor:** [@mptfire](https://github.com/mptfire)

This record applies the D-15 review schema to every selected contribution before implementation. It preserves upstream intent and attribution while documenting
the compatibility and security changes required for Blossom Server v6.4.1.

## Branch and integration contract

- All milestone work must be developed on the `v6.4.1` release-candidate branch, with `master` as an ancestor.
- Each accepted contribution must land as exactly one non-merge integration commit on `v6.4.1`.
- Each integration commit must retain attribution with a `Contribution-PR: #NN` trailer naming the upstream pull request.
- Adapted code, focused regression tests, the contributor-credited `CHANGELOG.md` entry, and review-record linkage belong in that contribution's single
  integration commit.
- When the integration commit must exist before its final 40-character SHA can be recorded here, a separate documentation commit may backfill only the final SHA
  and executed regression evidence.
- This review commit records decisions but does not integrate an upstream PR, so it intentionally carries no `Contribution-PR` trailer.

The branch invariant is checked with:

```sh
test "$(git branch --show-current)" = "v6.4.1" && git merge-base --is-ancestor master HEAD
```

## PR #53 — Reject multipart/urlencoded request bodies with 415 (BUD-02)

- **PR and contributor:** [#53](https://github.com/hzrd149/blossom-server/pull/53), [@mptfire](https://github.com/mptfire).
- **Original intent:** Prevent BUD-02 uploads from storing multipart or URL-encoded envelope bytes as if they were the raw blob, returning
  `415 Unsupported Media Type` with actionable ASCII guidance.
- **Affected files and behavior:** The upstream patch changes `src/routes/upload.ts`, `src/routes/media.ts`, and `src/utils/mime.ts`, and adds
  `tests/unit/multipart-guard.test.ts`. The revised integration instead centralizes admission before authentication while preserving the four exact
  `PUT /upload`, `HEAD /upload`, `PUT /media`, and `HEAD /media` surfaces.
- **Protocol or security basis:** BUD-02 accepts the blob as the raw request body. Rejecting envelope encodings prevents wrapper boundaries and headers from
  becoming stored, hash-addressed blob bytes. D-01 through D-05 additionally require pre-auth rejection, stable `415`, ASCII-only guidance, and cancellation
  without buffering.
- **Patch-release fit:** Correctness and integrity hardening for invalid input; it adds no public capability and preserves valid raw-body Blossom behavior.
- **Disposition:** **Integrate revised in Phase 1, Plan 01-02.** Do not directly cherry-pick the upstream patch.
- **Required deviations:** Move the check ahead of top-level authentication; cover all four exact surfaces; compare the base MIME type case-insensitively while
  ignoring valid parameters; reject every `multipart/*` type and `application/x-www-form-urlencoded`; cancel rejected `PUT` bodies without pulling or buffering
  them; keep `X-Reason` ASCII-only; and prove valid raw bodies continue into the existing auth and storage path.
- **Regression evidence:** Passed on 2026-10-01 with `deno test -A tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts`: 63 passed, 0
  failed. Plan 01-02 also runs its format, lint, and full-suite gates before completion.
- **Resulting phase:** Phase 1 — Request Intake Boundaries; requirements INTK-02 and INTK-07.
- **Integration commit:** Revised implementation landed on `v6.4.1` as non-merge commit `3c1045f68a7e0b7e30f6f478ea2bddf60d2a5801` with the
  `Contribution-PR: #53` trailer and the credited Unreleased changelog entry above.

## PR #54 — Reject mangled blob URLs cleanly; skip static-file stat for non-asset paths

- **PR and contributor:** [#54](https://github.com/hzrd149/blossom-server/pull/54), [@mptfire](https://github.com/mptfire).
- **Original intent:** Make blob-path matching exact enough that malformed URL suffixes return the normal `404`, and prevent malformed or overlong request paths
  from triggering unnecessary static-file filesystem work.
- **Affected files and behavior:** The upstream patch changes `src/routes/blobs.ts`, `src/server.ts`, `src/utils/url.ts`, `tests/e2e/blobs.test.ts`, and
  `tests/unit/url.test.ts`, adds `tests/unit/blob-hash.test.ts`, and contains an unrelated `src/admin/nostr-profile.ts` edit. The revised integration changes
  blob parsing and static admission without carrying the unrelated edit.
- **Protocol or security basis:** BUD-01 blob identity is a SHA-256 content address, and requested extensions are cosmetic; stored metadata remains
  authoritative for `Content-Type`. D-06 through D-13 require an anchored grammar and a separate decoded-path gate before Hono's static middleware can touch the
  filesystem.
- **Patch-release fit:** Input-validation and filesystem-boundary hardening that preserves ordinary blob URLs, cosmetic extensions, nested operator assets,
  Unicode filenames, and spaces.
- **Disposition:** **Integrate revised in Phase 1, Plan 01-03.** Do not directly cherry-pick the conflicting upstream patch.
- **Required deviations:** Accept upper- or lowercase 64-hex hashes and normalize internally; allow multiple dot-separated extension segments of 1–10 ASCII
  alphanumeric characters plus one trailing slash; retain stored MIME behavior; reject unsafe suffixes through normal routing; allow safe nested static paths;
  screen encoded separators, controls, backslashes, empty or interior dot segments, and traversal before static middleware; and omit the unrelated admin
  formatting change. D-11 retains the 255-segment and 2,048-path Unicode code-point caps and adds conservative UTF-8 byte caps of 255 per `decodeURI` segment
  and 2,048 for the complete `decodeURI` path before filesystem access. Real Deno/Hono `serveStatic` adapter coverage proves exact controls reach the adapter
  while byte overflows bypass it without filesystem warnings. D-12 is revised to record that the standard `Request` parser canonicalizes dot segments before
  application validation; normalized canonical equivalents are accepted while unsafe structure that survives normalization remains rejected.
- **Regression evidence:** Passed on 2026-10-01 with
  `deno test -A tests/unit/url.test.ts tests/unit/blob-path.test.ts tests/unit/envelope.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts`:
  152 passed, 0 failed. The expanded matrix covers exact 255/256-byte multibyte segments, retained reserved escapes at 255/258 filesystem bytes, exact
  2,048/2,049-byte multisegment Unicode paths, injected and real static adapters, and production `Request` canonicalization against the tracked favicon under
  `PUBLIC_DIR`. Plan 01-04 also runs targeted formatting, repository lint, and the complete server/client test task before completion.
- **Resulting phase:** Phase 1 — Request Intake Boundaries; requirements INTK-03 and INTK-07.
- **Integration commit:** Revised implementation landed on `v6.4.1` as non-merge commit `0f6b99ab36fbe600190f80de7c1ad56a708640b0` with the
  `Contribution-PR: #54` trailer and the credited Unreleased changelog entry above.

## PR #62 — fix(auth): require x tag on blob auth events; validate expiration strictly

- **PR and contributor:** [#62](https://github.com/hzrd149/blossom-server/pull/62), [@mptfire](https://github.com/mptfire).
- **Original intent:** Require blob-scoped `x` tags for protected operations and strictly reject malformed, expired, or excessively long-lived BUD-11
  authorization events.
- **Affected files and behavior:** The upstream patch changes `src/middleware/auth.ts` plus upload, delete, list, and auth tests. It makes missing `x` tags
  invalid, tightens expiration parsing, and adds a fixed 30-day maximum lifetime.
- **Protocol or security basis:** Matching `x` tags prevent a signed operation from authorizing a different blob, and strict integer parsing prevents malformed
  values such as `never` or partially parsed numbers from bypassing expiration. BUD-11 does not mandate a fixed 30-day lifetime.
- **Patch-release fit:** Hash scoping and strict expiration parsing are patch-level authorization corrections. An invented lifetime cap could reject otherwise
  valid clients and is outside the milestone's compatibility boundary.
- **Disposition:** **Adapted in Phase 2, Plan 02-01; not cherry-picked.** The local integration keeps the protocol-safe subset under INTK-04 while excluding
  the upstream lifetime policy.
- **Required deviations:** Require matching `x` tags and return `403` for both missing and mismatched required scope; accept expiration only as a complete
  decimal safe integer; retain expired-event rejection; explicitly exclude `MAX_AUTH_TTL_SECONDS` and every fixed 30-day authorization lifetime check; and
  preserve valid future expirations regardless of whether they are more than 30 days away.
- **Regression evidence:** Passed on 2026-10-01 with
  `deno test -A tests/unit/auth.test.ts tests/e2e/upload.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts`: 88 passed, 0 failed. The focused matrix covers
  malformed/unsafe and expired values, safe expirations beyond 30 days, standard and URL-safe Base64, missing/mismatched/matching scope across protected
  PUT/HEAD upload and DELETE, early body cancellation, deferred staged-write cleanup, non-deletion, and scoped upload fixtures.
- **Resulting phase:** Phase 2 — Authorization Compatibility; requirement INTK-04.
- **Integration commit:** The adapted code, tests, credited Unreleased changelog entry, and this review evidence are prepared for one non-merge `v6.4.1`
  commit carrying `Contribution-PR: #62`; only its final 40-character SHA remains pending for the Phase 2 documentation backfill.

## PR #63 — fix(blobs): serve active content (HTML/SVG/XML) as attachments with nosniff

- **PR and contributor:** [#63](https://github.com/hzrd149/blossom-server/pull/63), [@mptfire](https://github.com/mptfire).
- **Original intent:** Prevent uploaded HTML, SVG, XML, XSLT, and XHTML content from executing in the server's application origin by serving active types as
  attachments and adding `X-Content-Type-Options: nosniff`.
- **Affected files and behavior:** The upstream patch changes `src/routes/blobs.ts` and adds `tests/e2e/active-content.test.ts`; active MIME types receive an
  attachment disposition while ordinary media remains inline.
- **Protocol or security basis:** Uploaded bytes are untrusted. Attachment delivery and `nosniff` reduce stored-XSS and MIME-sniffing risk without changing blob
  identity or ordinary BUD-01 retrieval.
- **Patch-release fit:** Security hardening of response headers and active-document delivery, with normal media behavior retained.
- **Disposition:** **Accepted for integration in Phase 3; implementation remains out of Phase 1.**
- **Required deviations:** Rebase the response hardening on the Phase 1 blob parser; normalize MIME case and parameters; include HTML, SVG, XML, XSLT, and XHTML
  families; derive safe stable filenames from the content hash; retain inline delivery for non-active types; and preserve range and conditional response
  behavior.
- **Regression evidence:** Upstream reports E2E coverage for active types and a PNG control. Local release-candidate evidence remains pending Phase 3 and must
  prove active types are attachments with `nosniff` while ordinary media remains usable.
- **Resulting phase:** Phase 3 — Content and Logging Boundaries; requirement INTK-05.
- **Integration commit:** Pending Phase 3. The eventual single non-merge commit must carry `Contribution-PR: #63` and its final 40-character SHA must be linked
  in the continuation record.

## PR #64 — fix(logger): strip query strings from request logs

- **PR and contributor:** [#64](https://github.com/hzrd149/blossom-server/pull/64), [@mptfire](https://github.com/mptfire).
- **Original intent:** Prevent request query strings from being persisted in access-controlled logs while retaining useful request and response context.
- **Affected files and behavior:** The upstream patch changes `src/middleware/logger.ts` so the logger records the URL path without its query string.
- **Protocol or security basis:** Query parameters add unnecessary data exposure and operational noise in journald or syslog; omitting them reduces the logged
  privacy surface without changing request handling.
- **Patch-release fit:** Narrow privacy hardening with no API or protocol behavior change.
- **Disposition:** **Accepted for integration in Phase 3; implementation remains out of Phase 1.**
- **Required deviations:** Strip only the query string. Preserve method, pathname, status, timing, `X-Reason`, and error information; keep the log destination
  access-controlled; and add focused regression coverage because the upstream patch changes behavior without adding a test file.
- **Regression evidence:** Upstream describes the intended logger behavior but provides no new test file. Local evidence is pending Phase 3 and must prove query
  values are absent while the required operational fields remain present.
- **Resulting phase:** Phase 3 — Content and Logging Boundaries; requirement INTK-06.
- **Integration commit:** Pending Phase 3. The eventual single non-merge commit must carry `Contribution-PR: #64` and its final 40-character SHA must be linked
  in the continuation record.

## Flagged assumptions

The specless planning fallback requires these eight edge items to remain explicit and unresolved; this review does not infer new behavior from them:

- **INTK-01-adjacency — unresolved:** Behavior for equal or touching contribution-review items is unspecified.
- **INTK-01-empty — unresolved:** Behavior for empty, single, or null contribution-review input is unspecified.
- **INTK-01-ordering — unresolved:** Stable ordering for equal contribution-review elements is unspecified.
- **INTK-02-concurrency — unresolved:** Interruption and parallel-request guarantees for envelope rejection are unspecified.
- **INTK-03-concurrency — unresolved:** Interruption and parallel-request guarantees for blob/static path screening are unspecified.
- **INTK-07-adjacency — unresolved:** Behavior for equal or touching branch/integration items is unspecified.
- **INTK-07-empty — unresolved:** Behavior for empty, single, or null branch/integration input is unspecified.
- **INTK-07-ordering — unresolved:** Stable ordering for equal branch/integration elements is unspecified.

**Unresolved prohibition:** MUST NOT erase or misstate contributor attribution, or conceal material deviations from the upstream pull request, in the
contribution review record.
