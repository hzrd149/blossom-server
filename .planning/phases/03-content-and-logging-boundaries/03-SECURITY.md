---
phase: "03"
slug: content-and-logging-boundaries
status: verified
threats_open: 0
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: "2026-10-04"
---

# Phase 03 — Security

## Trust Boundaries

| Boundary | Description | Data Crossing |
| --- | --- | --- |
| Persisted MIME to browser policy | Stored metadata controls active-content handling | Untrusted MIME and blob bytes |
| Cosmetic suffix to blob lookup | URL decoration must not control response policy | Untrusted request path |
| Shared headers to response branches | Security metadata must survive GET, HEAD, range, and conditional paths | Response metadata |
| Request URL to access log | Operational logs must retain paths without query secrets | Potentially sensitive query data |
| Upstream contributions to release history | Adapted fixes must remain attributable and independently verifiable | Source changes and provenance |

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| T-03-01 | Elevation of Privilege / Spoofing | Active MIME and response headers | high | mitigate | `isActiveContentMime()`, attachment policy, `nosniff`, and active-content route matrix | closed |
| T-03-02 | Tampering / Spoofing | Request suffix and attachment filename | high | mitigate | Policy derives from stored MIME; filenames use the normalized hash and validated MIME extension | closed |
| T-03-03 | Elevation of Privilege | Conditional, range, and HEAD branches | medium | mitigate | GET 200, HEAD 200, range 206, and conditional 304 tests cover security metadata | closed |
| T-03-04 | Denial of Service / Compatibility | Ordinary media delivery | medium | mitigate | Ordinary-content controls plus blob/range regressions preserve inline streaming behavior | closed |
| T-03-05 | Repudiation | PR #63 integration history | medium | mitigate | Unique non-merge `Contribution-PR: #63` commit, credit, evidence, and full-SHA backfill | closed |
| T-03-06 | Information Disclosure | Access-log request and response lines | high | mitigate | One serialized `URL.pathname` is reused for both lines; focused tests exclude query names and values | closed |
| T-03-07 | Tampering / Repudiation | Encoded pathname and operational fields | medium | mitigate | Logger test preserves encoding, method, status, timing shape, line order, and `X-Reason` | closed |
| T-03-08 | Denial of Service | Test console interception | low | mitigate | The self-contained logger test restores `console.log` in `finally` | closed |
| T-03-09 | Repudiation | PR #63/#64 review linkage | medium | mitigate | Separate unique non-merge trailers, credited changelog/review evidence, and immutable full SHAs | closed |
| T-03-10 | Elevation of Privilege / Information Disclosure | Combined Phase 3 regressions | high | mitigate | Focused tests, retrieval regressions, formatting, lint, full suite, and prior-phase regression gate passed | closed |

## Accepted Risks Log

No accepted risks.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
| --- | ---: | ---: | ---: | --- |
| 2026-10-04 | 10 | 10 | 0 | GSD secure-phase L1 audit |

## Sign-Off

- [x] All threats have a disposition.
- [x] Accepted risks are documented.
- [x] `threats_open: 0` confirmed.
- [x] `status: verified` set in frontmatter.

**Approval:** verified 2026-10-04

The register is limited to the plan-time Phase 3 threat model. Separate advisory findings are tracked in `03-REVIEW.md`.
