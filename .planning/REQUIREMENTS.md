# Requirements: Blossom Server v6.4.1

**Defined:** 2026-09-30 **Core Value:** Operators can run a secure, protocol-compatible Blossom server whose stored bytes and authorization boundaries remain
trustworthy across supported storage backends.

## v1 Requirements

Requirements for the v6.4.1 hardening release. Each requirement maps to exactly one roadmap phase.

### Contribution Intake

- [ ] **INTK-01**: Maintainer can review each selected PR against the current codebase, protocol specifications, patch-release scope, and security constraints.
- [ ] **INTK-02**: Maintainer can integrate PR #53 so multipart and URL-encoded upload envelopes are rejected without buffering rejected bodies.
- [ ] **INTK-03**: Maintainer can integrate PR #54 so malformed blob paths are rejected and do not trigger unnecessary static-file filesystem operations,
      without rejecting reasonable valid extensions.
- [ ] **INTK-04**: Maintainer can integrate the safe parts of PR #62 so required `x` tags and expiration integers are validated without enforcing an
      undocumented 30-day lifetime.
- [ ] **INTK-05**: Maintainer can integrate PR #63 so active HTML, SVG, XML, and XSLT content cannot execute in the server's application origin.
- [ ] **INTK-06**: Maintainer can integrate PR #64 so request logs omit query strings while retaining useful method, path, status, timing, and error
      information.

### Verification

- [ ] **VERI-01**: Maintainer can verify every integrated fix with focused regression tests covering its original failure or security condition.
- [ ] **VERI-02**: Maintainer can run formatting, linting, and the complete Deno test suite successfully on the integrated release candidate.
- [ ] **VERI-03**: Maintainer can verify affected generated assets, Docker packaging, and Nix artifacts without relying on stale build outputs.
- [ ] **VERI-04**: Maintainer can confirm the combined changes preserve Blossom protocol compatibility, streaming behavior, and both storage backends.

### Release

- [ ] **RELS-01**: Users can read accurate v6.4.1 release notes describing every included user-facing fix.
- [ ] **RELS-02**: Maintainer can bump all authoritative package-version references from 6.4.0 to 6.4.1.
- [ ] **RELS-03**: Maintainer can produce and verify the v6.4.1 release artifacts using a documented, repeatable release checklist.
- [ ] **RELS-04**: Maintainer can close the milestone with traceability from selected PRs through implementation, tests, changelog entries, and release output.

## v2 Requirements

Deferred to the v6.5 minor release and excluded from the current roadmap.

### Features

- **FEAT-01**: Clients can filter blob lists by MIME type using PR #55.
- **FEAT-02**: Operators can configure video metadata retention and landing-page optimization defaults using PR #60.

## Out of Scope

| Feature                                         | Reason                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Fixed 30-day authorization lifetime             | Not required by BUD-11 and may reject otherwise valid client tokens |
| MIME-type list filtering from PR #55            | Additive API capability belongs in v6.5                             |
| Media configuration and UI behavior from PR #60 | New operator-facing features belong in v6.5                         |
| Unrelated refactors or feature work             | Preserve a focused, low-risk patch release                          |

## Traceability

Roadmap phase assignments are populated during roadmap creation.

| Requirement | Phase   | Status  |
| ----------- | ------- | ------- |
| INTK-01     | Phase 1 | Pending |
| INTK-02     | Phase 1 | Pending |
| INTK-03     | Phase 1 | Pending |
| INTK-04     | Phase 2 | Pending |
| INTK-05     | Phase 3 | Pending |
| INTK-06     | Phase 3 | Pending |
| VERI-01     | Phase 4 | Pending |
| VERI-02     | Phase 4 | Pending |
| VERI-03     | Phase 4 | Pending |
| VERI-04     | Phase 4 | Pending |
| RELS-01     | Phase 5 | Pending |
| RELS-02     | Phase 5 | Pending |
| RELS-03     | Phase 5 | Pending |
| RELS-04     | Phase 5 | Pending |

**Coverage:**

- v1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---

_Requirements defined: 2026-09-30_ _Last updated: 2026-09-30 after roadmap creation_
