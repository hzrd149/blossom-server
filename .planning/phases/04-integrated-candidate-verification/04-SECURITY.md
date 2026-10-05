---
phase: "04"
slug: integrated-candidate-verification
status: verified
verdict: SECURED
threats_total: 11
threats_closed: 11
threats_open: 0
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: "2026-10-05"
---

# Phase 04 — Security Verification

## Verdict

**SECURED** — all 11 plan-time threats are resolved: 10 are mitigated and one low-severity residual risk is explicitly accepted. No threat at or above the configured `high` blocking threshold remains open.

## Threat Register

| Threat ID | Category | Severity | Disposition | Mitigation evidence | Status |
| --- | --- | ---: | --- | --- | --- |
| T-04-01 | Elevation of Privilege / Information Disclosure | high | mitigate | Exact multipart classification plus attachment and `nosniff` response regressions | closed |
| T-04-02 | Tampering / Denial of Service | medium | mitigate | Weak/list/exact-wildcard matching, mixed-wildcard rejection, and zero-read 304 assertions | closed |
| T-04-03 | Tampering | medium | mitigate | Stored MIME remains the sole response-policy authority; suffix-independence regressions pass | closed |
| T-04-04 | Denial of Service | low | accept | Accepted residual unchanged streaming risk; native range/zero-copy behavior and regressions constrain exposure | closed |
| T-04-05 | Tampering / Repudiation | high | mitigate | `04-VERIFICATION-EVIDENCE.md` binds all gates to source candidate `331dabdd4189d3a90226650387341fb8aeae3ea6`; evidence commit `3514aa4` changes planning evidence only | closed |
| T-04-06 | Tampering | high | mitigate | Repeatable asset hashes, current pull/no-cache Docker identity, and all four deterministic Nix outputs are retained in the evidence ledger | closed |
| T-04-07 | Repudiation | medium | mitigate | Five immutable PR/SHA rows and the final-candidate 234/0 contribution matrix | closed |
| T-04-08 | Information Disclosure / Elevation of Privilege | high | mitigate | Frozen typecheck, shared storage interface wiring, package builds, and the explicit S3 contract/type/build-only boundary | closed |
| T-04-09 | Spoofing / Elevation of Privilege | high | mitigate | Signed-event expiration, exact `x` scope, cleanup, delete, and list regressions pass | closed |
| T-04-10 | Denial of Service | high | mitigate | Upload/media rejection tests confirm one cancellation with zero request-body pulls | closed |
| T-04-11 | Tampering | medium | mitigate | Current Docker digest, resolved base identity, pull/no-cache command, and the explicit reproducibility limitation are recorded | closed |

## Accepted Risks Log

| Threat ID | Risk | Severity | Rationale |
| --- | --- | ---: | --- |
| T-04-04 | Residual GET/HEAD/range streaming denial-of-service exposure | low | Phase 4 intentionally preserves established streaming behavior. Native `readRange()`, zero-copy delivery, normal GET/range controls, and regression coverage constrain the exposure; changing the streaming architecture is outside this maintenance patch. |

## Corroborating Evidence

- Source candidate `331dabdd4189d3a90226650387341fb8aeae3ea6` is an ancestor of HEAD.
- Post-candidate commit `3514aa4` changes only `04-02-SUMMARY.md` and `04-VERIFICATION-EVIDENCE.md`.
- The retained client and stylesheet hashes match current generated outputs.
- Docker image digest `sha256:80bd3b6f3a77e3e9416eebe4ca44a12b610112685bf44bcf48f096d52621cf66` exists under the candidate tag.
- All four current Nix outputs resolve.
- Final verification reports 11/11 must-haves passed.
- Both Phase 4 summaries contain no unregistered `## Threat Flags`.

## Security Audit Trail

| Audit Date | Threats Total | Mitigated | Accepted | Open | Run By |
| --- | ---: | ---: | ---: | ---: | --- |
| 2026-10-05 | 11 | 10 | 1 | 0 | GSD secure-phase L1 audit |

## Sign-Off

- [x] All threats have a disposition.
- [x] Accepted risks are documented.
- [x] `threats_open: 0` confirmed.
- [x] `status: verified` and `verdict: SECURED` set in frontmatter.

**Approval:** verified 2026-10-05
