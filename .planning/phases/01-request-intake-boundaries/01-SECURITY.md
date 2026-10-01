---
phase: 01-request-intake-boundaries
reviewed: 2026-10-01
status: secured
verdict: SECURED
asvs_level: 1
threats_total: 16
threats_closed: 16
threats_open: 0
block_on: high
---

# Phase 01 Security Verification

## Verdict

**SECURED** — all 16 threats identified by the Phase 01 plans are mitigated in the implementation and covered by focused evidence.

## Verified Mitigations

| Threat  | Severity | Verified mitigation                                                                                                                                              |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-01-01 | medium   | Contribution decisions contain the required review and attribution fields.                                                                                       |
| T-01-02 | high     | Work is on `v6.4.1`; `master` ancestry and unique PR #53/#54 integration trailers are verified.                                                                  |
| T-01-03 | high     | PR #53 envelope admission is implemented before auth in `src/middleware/envelope.ts` and `src/server.ts`.                                                        |
| T-01-04 | high     | PR #54 path checks run before static/blob filesystem handling in `src/utils/url.ts`, `src/server.ts`, and `src/routes/blobs.ts`.                                 |
| T-01-05 | high     | Envelope checks are limited to the intended upload/media surfaces and normalized MIME types.                                                                     |
| T-01-06 | high     | Accepted requests continue to the unchanged route-level authorization checks.                                                                                    |
| T-01-07 | high     | Rejected PUT bodies are cancelled before the 415 response; tests assert cancellation without body pulls.                                                         |
| T-01-08 | low      | Rejection responses use a fixed ASCII reason and safe headers.                                                                                                   |
| T-01-09 | high     | Encoded and decoded static-candidate checks precede static middleware invocation.                                                                                |
| T-01-10 | high     | Blob parsing is anchored and validation precedes database or storage access.                                                                                     |
| T-01-11 | medium   | Stored blob metadata, not a cosmetic URL suffix, controls response MIME.                                                                                         |
| T-01-12 | medium   | Unicode, space, and exact-boundary cases have focused coverage.                                                                                                  |
| T-01-13 | high     | `isStaticCandidate` enforces 255-byte segment and 2,048-byte path limits on the valid `decodeURI` representation before Hono/Deno filesystem access.             |
| T-01-14 | high     | Request-layer dot-segment canonicalization is tested against the tracked favicon, while normalized-path validation and `PUBLIC_DIR` confinement remain enforced. |
| T-01-15 | medium   | Exact 252-, 255-, and 2,048-byte positive controls reach the real adapter without warnings, preserving compatible operator assets.                               |
| T-01-16 | medium   | The revised D-12 contract, PR #54 deviation, attribution, focused evidence, and unchanged integration-trailer history are recorded in phase artifacts.           |

## Verification Evidence

- Focused Phase 01 test suite: **152 passed, 0 failed**.
- Full suite: **356 server tests and 2 client tests passed**.
- No unregistered `## Threat Flags` occur in Phase 01 summaries.
- Open threats: **0**.

## Security Audit 2026-10-01 — Gap Closure

| Metric                          | Count |
| ------------------------------- | ----- |
| New registered threats verified | 4     |
| Closed                          | 4     |
| Open                            | 0     |

The prior byte-limit concern is closed by Plan 01-04. The post-gap code review is clean.
