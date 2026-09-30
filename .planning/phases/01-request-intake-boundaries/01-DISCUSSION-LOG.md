# Phase 1: Request Intake Boundaries - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents. Decisions are captured in CONTEXT.md — this log preserves the
> alternatives considered.

**Date:** 2026-09-30 **Phase:** 1-Request Intake Boundaries **Areas discussed:** Envelope rejection surface, valid blob-path grammar, static-asset screening,
contribution decision record

---

## Envelope Rejection Surface

| Decision          | Alternatives considered                                    | Selected                                  |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------- |
| Route coverage    | All upload/media PUT and HEAD paths; upload only; PUT only | All four paths                            |
| Validation order  | Auth first; envelope first; preserve differing route order | Envelope first                            |
| MIME recognition  | Normalized base type; raw prefix; exact common types only  | Normalized `multipart/*` plus URL-encoded |
| Response contract | `415` with guidance; `400`; generic `415`                  | `415` with human-only `X-Reason`          |

**User's choice:** Apply broad, normalized rejection consistently before authentication.

**Notes:** The user initially considered `400`, then selected `415` because the status itself gives client software the supported-type signal. `X-Reason` is
explicitly not a client-readable contract.

---

## Valid Blob-Path Grammar

| Decision             | Alternatives considered                                                         | Selected                   |
| -------------------- | ------------------------------------------------------------------------------- | -------------------------- |
| Extension characters | Alphanumeric; add `_`/`-`; any slash-free text                                  | Alphanumeric               |
| Hash case            | Normalize either case; lowercase only; preserve case                            | Normalize either case      |
| Near-miss tolerance  | Strict PR #54 grammar; trailing slash only; loose prefix; bounded compatibility | Bounded compatibility      |
| MIME mismatch        | Serve stored type; redirect; `404`                                              | Serve stored type directly |

**User's choice:** Preserve compatibility for harmless bad URLs while rejecting unsafe or JSON-like suffixes.

**Notes:** Multiple bounded extensions and a trailing slash are accepted. Requested extensions remain cosmetic because the hash identifies content and stored
metadata determines `Content-Type`.

---

## Static-Asset Screening

| Decision            | Alternatives considered                                                       | Selected                               |
| ------------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| Path shape          | Flat portable paths; safe nested paths; all paths                             | Safe nested paths                      |
| Length boundary     | 255/2,048; 128/1,024; segment limit only                                      | 255 per segment, 2,048 overall         |
| Filename characters | Portable ASCII; ordinary decoded names with exclusions; host filesystem rules | Ordinary decoded names with exclusions |
| Failed candidate    | Continue routing; immediate `404`; immediate `400`                            | Continue routing                       |

**User's choice:** Support operator-provided nested public trees without allowing malformed requests to trigger filesystem errors.

**Notes:** Inspection confirmed Hono's current middleware checks traversal but does not enforce these length limits before calling Deno filesystem APIs.

---

## Contribution Decision Record

| Decision        | Alternatives considered                                            | Selected                          |
| --------------- | ------------------------------------------------------------------ | --------------------------------- |
| Record location | Dedicated review document; summaries/commits; changelog            | Dedicated review document         |
| Entry depth     | Full rationale and traceability; concise result; command checklist | Full rationale and traceability   |
| Git integration | Cherry-pick plus fixes; reimplement; squash                        | One squash commit per accepted PR |
| Attribution     | Full identity/SHA linkage; handle plus PR; PR and result commit    | Contributor handle plus PR number |

**User's choice:** Keep one auditable Phase 1 review, squash accepted contributions, and preserve contributor credit in pending changelog entries for release
notes.

**Notes:** Each review entry also links its decision, deviations, regression evidence, phase, and resulting integration commit.

## the agent's Discretion

None.

## Deferred Ideas

None.
