# Walking Skeleton — Blossom Server

**Phase:** 1 **Generated:** 2026-09-30

## Capability Proven End-to-End

The existing production server already accepts a raw Blossom upload, streams it through worker-backed hash verification into LibSQL plus local or S3 storage,
and retrieves the stored blob through the Hono application while the landing and admin interfaces share the same process.

Phase 1 does not scaffold a new application. Its tracer tasks exercise and harden this established request-to-storage-to-response backbone.

## Architectural Decisions

| Decision              | Choice                                                                                            | Rationale                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Runtime and framework | Deno 2 with Hono                                                                                  | The tracked server, tasks, middleware, and in-process E2E tests already use this stack.                                      |
| Data layer            | LibSQL metadata plus `IBlobStorage` adapters                                                      | Metadata stays in LibSQL while immutable blob bytes remain behind local-disk and S3 adapters.                                |
| Authentication        | BUD-11 Nostr signed events with explicit route enforcement                                        | Global middleware parses request events; each protected Blossom route enforces the relevant operation.                       |
| Deployment target     | Deno process through `deno task start`; Docker and Nix packaging exist                            | A documented local full-stack command already exercises the production entry point; packaging validation belongs to Phase 4. |
| Directory layout      | Modular monolith under `src/routes`, `src/middleware`, `src/db`, `src/storage`, and `src/workers` | Request policy, persistence, blob storage, and worker execution have stable tracked boundaries.                              |

## Stack Touched in Phase 1

- [x] Project scaffold — existing `deno.json`, formatting, linting, build, and test tasks
- [x] Routing — existing Hono application and Blossom route composition
- [x] Database — existing LibSQL metadata reads and upload writes
- [x] UI — existing server-rendered landing/admin surfaces and hydrated upload island
- [x] Deployment — `deno task start` runs the local full-stack production entry point

## Out of Scope (Assigned to Later Slices)

- Phase 2 owns revised PR #62 authorization compatibility.
- Phase 3 owns PRs #63 and #64 for active-document delivery and query-safe logging.
- Phase 4 owns combined protocol, storage-backend, build, Docker, and Nix verification.
- Phase 5 owns the release PR, versioning, tag, and package publication.

## Subsequent Slice Plan

- Phase 1: Review all selected contributions and integrate revised PRs #53 and #54 at the request boundary.
- Phase 2: Enforce BUD-11 hash scope and expiration parsing without a fixed lifetime cap.
- Phase 3: Protect the application origin and logs.
- Phase 4: Verify the integrated release candidate and packaging outputs.
- Phase 5: Release v6.4.1 from merged `master`.
