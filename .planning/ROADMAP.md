# Roadmap: Blossom Server v6.4.1

## Overview

This milestone integrates five selected patch-level contributions as vertical slices: review each contribution against the current server and Blossom
specifications, adapt it where compatibility requires, prove it with focused regression tests, and integrate it before validating and releasing the combined
candidate. The sequence starts with request-boundary hardening, isolates the compatibility-sensitive BUD-11 change, completes response and logging protections,
then runs the full quality and packaging gates before cutting v6.4.1.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Request Intake Boundaries** - Review the selected contributions and integrate PRs #53 and #54 safely. (completed 2026-10-01)
- [x] **Phase 2: Authorization Compatibility** - Integrate the protocol-safe parts of PR #62 without a fixed lifetime cap. (completed 2026-10-01)
- [x] **Phase 3: Content and Logging Boundaries** - Integrate PRs #63 and #64 to protect the application origin and logs. (completed 2026-10-03)
- [x] **Phase 4: Integrated Candidate Verification** - Prove the combined candidate across protocol, storage, and build gates. (completed 2026-10-05)
- [ ] **Phase 5: v6.4.1 Release** - Version, document, package, and close the traceable hardening release.

## Phase Details

### Phase 1: Request Intake Boundaries

**Goal:** Selected contributions are reviewed and upload/blob requests are rejected safely at the protocol boundary.

**Depends on:** Nothing (first phase)

**Requirements:** INTK-01, INTK-02, INTK-03, INTK-07

**Success Criteria** (what must be TRUE):

1. Maintainer can inspect PRs #53, #54, #62, #63, and #64 against current code, authoritative Blossom behavior, patch-release scope, and security constraints,
   with an explicit integrate-or-revise decision for each.
2. A multipart or URL-encoded `PUT /upload` is rejected without storing or buffering its envelope, while a raw BUD-02 blob body still uploads successfully.
3. A malformed blob path is rejected before static-file filesystem handling, while valid hash paths with reasonable extensions still resolve normally.
4. Focused regression tests for PRs #53 and #54 pass alongside the existing upload and blob-retrieval behavior.
5. The milestone and every selected contribution are integrated on `v6.4.1`, with no milestone implementation committed directly to `master`.

**Plans:** 4/4 plans complete

**Wave 1**

- [x] 01-01-PLAN.md — Record five-PR dispositions, branch policy, and the locked Unicode code-point rule.

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 01-02-PLAN.md — Integrate revised PR #53 with pre-auth envelope rejection, streaming tests, changelog credit, and commit traceability.

**Wave 3** _(blocked on Wave 2 completion)_

- [x] 01-03-PLAN.md — Integrate revised PR #54 with exact blob grammar, pre-filesystem static screening, regression coverage, and commit traceability.

**Wave 4** _(gap closure; blocked on Wave 3 completion)_

- [x] 01-04-PLAN.md — Align static candidacy with Hono/Deno filesystem bytes and the observable dot-segment normalization contract.

### Phase 2: Authorization Compatibility

**Goal:** As a Blossom server operator, I want to accept only correctly scoped BUD-11 authorization while honoring safe future expirations, so that protected
blob operations stay secure without rejecting compatible clients.

**Depends on:** Phase 1

**Requirements:** INTK-04

**Success Criteria** (what must be TRUE):

1. A protected operation rejects an authorization event that lacks the required matching blob-hash `x` tag and accepts an otherwise valid event whose `x` tag
   matches the requested blob.
2. Malformed, non-integer, or expired expiration values are rejected, while a valid future expiration remains accepted regardless of whether it is more than 30
   days away.
3. Focused PR #62 regression tests pass without changing authentication behavior for valid existing Blossom clients.

**Plans:** 1/1 plans complete

**Wave 1**

- [x] 02-01-PLAN.md — Adapt PR #62 with strict safe-integer expiration parsing, exact blob scope, cleanup/compatibility regressions, and contribution
      traceability.

### Phase 3: Content and Logging Boundaries

**Goal:** As a Blossom server operator, I want to isolate active uploaded documents from the application origin and strip query data from request logs, so that
hosted blobs and operational logs cannot expose users or secrets.

**Depends on:** Phase 2

**Requirements:** INTK-05, INTK-06

**Success Criteria** (what must be TRUE):

1. Retrieved HTML, SVG, XML, and XSLT blobs cannot execute as active content in the server's application origin.
2. Ordinary blob retrieval, including range and conditional behavior, remains usable after active-document hardening.
3. Request logs show method, path, status, timing, and error context without recording query strings or their values.
4. Focused regression tests for PRs #63 and #64 pass alongside the existing retrieval and logging behavior.

**Plans:** 2/2 plans complete

**Wave 1**

- [x] 03-01-PLAN.md — Adapt PR #63 with exact active-MIME classification, complete successful-response hardening, ordinary-media regressions, and contribution
      traceability.

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 03-02-PLAN.md — Adapt PR #64 with query-free paired logging, preserve operational context, backfill both contribution identities, and run the complete
      Phase 3 gate.

### Phase 4: Integrated Candidate Verification

**Goal:** The combined v6.4.1 candidate is protocol-compatible, storage-safe, and reproducible across affected gates.

**Depends on:** Phase 3

**Requirements:** VERI-01, VERI-02, VERI-03, VERI-04

**Success Criteria** (what must be TRUE):

1. Focused regression coverage for all five selected contributions reproduces each original failure or security condition and passes against the integrated
   candidate.
2. Formatting checks, linting, and the complete Deno test suite pass together on the integrated candidate.
3. Affected generated assets, Docker packaging, and Nix artifacts build and verify without relying on stale outputs.
4. End-to-end checks confirm the combined fixes preserve Blossom behavior, rejected-body streaming semantics, and correct operation with both local-disk and S3
   storage.

**Plans:** 2/2 plans complete

**Wave 1**

- [x] 04-01-PLAN.md — Resolve multipart active-content and weak If-None-Match advisories with focused real-app regressions.

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 04-02-PLAN.md — Verify one candidate SHA across contribution, Deno, storage, generated-asset, Docker, and Nix gates.

### Phase 5: v6.4.1 Release

**Goal:** Users and maintainers receive a verified v6.4.1 package with accurate notes and reusable release traceability.

**Depends on:** Phase 4

**Requirements:** RELS-01, RELS-02, RELS-03, RELS-04, RELS-05, RELS-06

**Success Criteria** (what must be TRUE):

1. Users can read v6.4.1 release notes that accurately describe every included user-facing fix.
2. Every authoritative package-version reference reports 6.4.1 rather than 6.4.0.
3. Maintainer can produce and verify the release artifacts by following a documented checklist reusable for later releases.
4. Maintainer can trace each selected PR through its adapted implementation, regression tests, changelog entry, and verified release output before closing the
   milestone.
5. A GitHub release PR from `v6.4.1` to `master` passes all required CI checks before it is merged.
6. The `v6.4.1` tag is created and pushed from merged `master`, and the Deno package is published from that same tagged state.

**Plans:** 4 plans

**Wave 1**

- [ ] 05-01-PLAN.md — Prepare v6.4.1 metadata/evidence, seal one local-gate SHA, and open the release PR.

**Wave 2** _(blocked on Wave 1 completion)_

- [ ] 05-02-PLAN.md — Verify every current PR check and human-authorize the exact SHA-guarded release merge.

**Wave 3** _(blocked on Wave 2 completion)_

- [ ] 05-03-PLAN.md — Bind and human-authorize the exact merged-master tag push, including GHCR side effects.

**Wave 4** _(blocked on Wave 3 completion)_

- [ ] 05-04-PLAN.md — Human-authorize tagged JSR publication and submit final receipts through a docs-only PR.

## Progress

**Execution Order:** Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase                                | Plans Complete | Status      | Completed  |
| ------------------------------------ | -------------- | ----------- | ---------- |
| 1. Request Intake Boundaries         | 4/4            | Complete    | 2026-10-01 |
| 2. Authorization Compatibility       | 1/1            | Complete    | 2026-10-01 |
| 3. Content and Logging Boundaries    | 2/2 | Complete    | 2026-10-03 |
| 4. Integrated Candidate Verification | 2/2 | Complete    | 2026-10-05 |
| 5. v6.4.1 Release                    | 0/4            | Not started | -          |
