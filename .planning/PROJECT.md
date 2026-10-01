# Blossom Server

## What This Is

Blossom Server is a Deno 2 HTTP server implementing the Blossom blob-storage protocol for Nostr clients and server operators. It provides content-addressed blob
upload, retrieval, listing, mirroring, media optimization, moderation, retention, local/S3 storage, and server-rendered landing and administration interfaces.

The current milestone is a v6.4.1 hardening release. It will use the repository's open pull requests as a practical exercise in repeatable contribution intake:
evaluate upstream work, correct scope or compatibility issues, integrate it, verify the complete server, and publish a new package version.

## Core Value

Operators can run a secure, protocol-compatible Blossom server whose stored bytes and authorization boundaries remain trustworthy across supported storage
backends.

## Requirements

### Validated

- ✓ Clients can upload, retrieve, list, mirror, delete, and report content through the implemented Blossom BUD endpoints — existing
- ✓ BUD-11 Nostr events authenticate protected blob operations — existing
- ✓ Blob bytes are streamed, hash-verified, and committed through local-disk or S3 storage adapters — existing
- ✓ Operators can configure media processing, storage rules, pruning, and server behavior through validated YAML — existing
- ✓ Operators can inspect and manage the service through server-rendered landing and admin interfaces — existing
- ✓ Deno tests, linting, formatting, Docker builds, and deterministic Nix validation provide release-quality checks — existing
- ✓ Multipart and URL-encoded upload envelopes are rejected before auth or body processing — Phase 1
- ✓ Malformed blob and static paths fall through safely before storage or filesystem access — Phase 1

### Active

- [ ] Require protocol-mandated blob hash scoping and strictly validate BUD-11 expiration values without imposing an undocumented fixed lifetime policy (revised
      PR #62)
- [ ] Prevent uploaded active document types from executing in the application origin (PR #63)
- [ ] Exclude request query strings from persisted request logs (PR #64)
- [ ] Review and integrate each selected contribution with explicit compatibility analysis, changelog coverage, and regression tests
- [ ] Build the milestone on the `v6.4.1` release-candidate branch and merge every selected contribution into that branch
- [ ] Verify the integrated v6.4.1 candidate through the Deno quality gates and all build/package checks affected by the changes
- [ ] Open a release PR from `v6.4.1` to `master`, require green CI before merge, and only then tag and publish v6.4.1 from `master`
- [ ] Cut and document v6.4.1 using a repeatable release procedure that can be reused for later milestones

### Out of Scope

- PR #55 MIME-type filtering — additive API capability belongs in the v6.5 minor release
- PR #60 video metadata and optimize-by-default settings — new configuration and UI behavior belong in v6.5
- A fixed 30-day BUD-11 authorization lifetime — not required by the protocol and potentially incompatible with valid clients; any lifetime policy requires
  separate design
- Unrelated refactors or feature development — this milestone stays focused on patch-level hardening and release practice

## Context

- The repository is currently at v6.4.0, with an empty `Unreleased` changelog section.
- Seven pull requests are open against `master`; five are patch-level security, privacy, or correctness candidates.
- PR #54 currently conflicts with `master`; PR #62 contains a desirable authorization fix coupled to a questionable 30-day expiration cap that must be separated
  or revised.
- GitHub currently shows no reviews on the candidate PRs, so local review and verification are part of acceptance rather than administrative follow-up.
- The codebase is a modular Deno/Hono application. Route ordering, explicit auth enforcement, streaming body cleanup, storage adapter boundaries, and
  worker-pool behavior are architectural invariants.
- The exercise should leave behind a clear method for reviewing external contributions, deciding release scope, applying changes safely, verifying packaging,
  and completing a release.

## Constraints

- **Release compatibility**: Changes must remain appropriate for a patch release — no new public capabilities or intentional breaking behavior beyond correcting
  invalid or insecure behavior.
- **Protocol**: BUD-01, BUD-02, and BUD-11 behavior must be checked against the authoritative Blossom specifications — security hardening must not invent
  undocumented interoperability requirements.
- **Runtime**: All development, formatting, linting, testing, and builds use Deno 2 — the repository has no npm workflow.
- **Streaming**: Rejected upload bodies must be cancelled or drained according to the established route semantics — large bodies must never be buffered merely
  to reject them.
- **Storage**: Integrated behavior must work with both local and S3 adapters and preserve hash-before-commit integrity.
- **Quality gates**: Run `deno fmt`, `deno lint`, and `deno task test`; run build or Nix checks whenever affected inputs or generated client assets require
  them.
- **Release notes**: Every user-visible fix must be recorded under `CHANGELOG.md` → `Unreleased` before cutting v6.4.1.
- **Branching**: Each release milestone is developed on `v<version>` from `master`; selected contribution PRs merge into that release-candidate branch.
- **Release gate**: A GitHub release PR from `v<version>` to `master` must pass required CI before merge; tagging and Deno publishing happen only afterward from
  the merged `master` state.

## Key Decisions

| Decision                                                         | Rationale                                                                                                  | Outcome   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| Target v6.4.1 before v6.5                                        | The selected work consists of security, privacy, and correctness fixes rather than new capabilities        | — Pending |
| Scope PRs #53, #54, #62, #63, and #64                            | These changes fit a focused hardening release; #55 and #60 introduce minor-version features                | — Pending |
| Revise PR #62 before integration                                 | Matching `x` tags and strict integer parsing are correct, but a fixed 30-day cap is not mandated by BUD-11 | — Pending |
| Treat contribution intake and release as explicit milestone work | The milestone should establish a reusable workflow, not only produce a version bump                        | — Pending |
| Use one `v<version>` branch per release milestone                | Keeps milestone work and incoming contributions isolated from `master` until the candidate is verified     | — Pending |
| Ship through a green release PR before tagging or publishing     | CI validates the candidate merged to `master`; published artifacts originate from the canonical state      | — Pending |
| Preserve code-point caps and add filesystem-facing UTF-8 byte caps | The two measurements protect policy complexity and Hono/Deno filesystem path limits at distinct boundaries | ✓ Phase 1 |
| Define dot-segment safety at the observable Request layer        | The runtime canonicalizes request paths before application middleware; normalized paths remain confined to `PUBLIC_DIR` | ✓ Phase 1 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-10-01 after Phase 1_
