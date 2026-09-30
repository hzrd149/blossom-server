# Codebase Concerns

**Analysis Date:** 2026-09-30

## Tech Debt

**Legacy database migration loads the full database into memory and writes rows individually:**

- Issue: `maybeMigrateLegacyDb()` reads all blobs, owners, and access rows into arrays, builds a deduplication set, then performs one insert per row without a
  transaction. Large installations incur memory and startup-time costs, and an interrupted import can leave a partial new database alongside the backup.
- Files: `src/db/legacy-migration.ts`
- Impact: Migration can use substantial memory and take a long time; failures after the old DB has been renamed require operator recovery.
- Fix approach: Stream/paginate source rows and import inside a transaction or staged database, then atomically switch files only after validation.

**Storage and metadata changes span multiple operations:**

- Issue: Upload, media, delete, and prune paths coordinate filesystem/S3 changes with database writes without a transaction spanning both systems. For example,
  `DELETE /:filename` deletes the DB row before best-effort storage removal, while media commits storage before inserting metadata.
- Files: `src/routes/delete.ts`, `src/routes/upload.ts`, `src/routes/media.ts`, `src/prune/prune.ts`, `src/storage/local.ts`, `src/storage/s3.ts`
- Impact: Process termination or backend errors can leave orphaned files/objects or metadata that points to missing content; best-effort cleanup can conceal
  persistent drift.
- Fix approach: Define explicit reconciliation semantics, make operations idempotent, and add a periodic inventory/reconciliation mechanism for storage versus
  DB state.

## Known Bugs

**No confirmed runtime bug was established during this read-only mapping.**

- Symptoms: Not detected.
- Files: Not applicable.
- Trigger: Not applicable.
- Workaround: Not applicable.

## Security Considerations

**Mirroring retains a DNS time-of-check/time-of-use window:**

- Risk: A hostname can resolve to a public address during validation and change before the HTTP client resolves/connects, potentially reaching a private address
  (DNS rebinding).
- Files: `src/routes/mirror.ts`, `src/utils/ip-guard.ts`
- Current mitigation: Literal IPv4/IPv6 checks, A/AAAA validation rejecting any non-public record, manually followed redirects with validation per hop, and a
  connection/header timeout. The source comments explicitly document that Deno fetch cannot pin the validated address.
- Recommendations: Use an outbound fetch transport that pins validated DNS answers or enforce an equivalent network-level egress policy; retain redirect
  revalidation.

**Admin Basic Auth password may be printed in startup logs:**

- Risk: When dashboard auth is enabled without a configured password, `main.ts` generates a password and logs it. Logs may be collected or retained more broadly
  than the admin credential store.
- Files: `main.ts`, `src/routes/admin-router.tsx`
- Current mitigation: Password is randomly generated with `crypto.getRandomValues()` and dashboard access is guarded by Basic Auth.
- Recommendations: Deliver the generated credential through a restricted one-time channel or require explicit secret configuration in managed deployments; avoid
  routine log collection of the credential.

## Performance Bottlenecks

**Media processing can run expensive native processes per request without a dedicated concurrency limit:**

- Problem: Media requests dispatch an upload worker for input writes, then synchronously invoke image/video optimization, probing, and thumbnail generation on
  the main server process.
- Files: `src/routes/media.ts`, `src/optimize/image.ts`, `src/optimize/video.ts`, `src/optimize/thumbnail.ts`, `src/optimize/dimensions.ts`
- Cause: Worker capacity bounds inbound upload jobs, but native `sharp`, `ffprobe`, and `ffmpeg` work is outside that pool; configured input limits still permit
  large media files.
- Improvement path: Add a separate bounded media-processing pool/semaphore, enforce time/resource limits for child processes, and measure temporary disk usage
  under concurrent jobs.

**Mirroring can occupy a worker and temporary disk for the full response body:**

- Problem: The default `mirror.bodyTimeout` is zero (no overall transfer timeout), and the upload worker writes the origin response to local temporary storage
  until completion.
- Files: `src/config/schema.ts`, `src/routes/mirror.ts`, `src/workers/upload-worker.ts`, `src/storage/s3.ts`
- Cause: Connection/header timeouts do not cover the body unless an operator configures `bodyTimeout`; multiple slow origins can consume all worker slots and
  temp disk.
- Improvement path: Document and consider a finite default body deadline or minimum-throughput policy, and expose active transfer/temp-disk metrics.

## Fragile Areas

**Media route is a long multi-stage workflow with compensating cleanup:**

- Files: `src/routes/media.ts`, `src/optimize/index.ts`, `src/db/blobs.ts`
- Why fragile: The handler validates and streams a request, handles derivative reuse, invokes native processing, hashes/commits original and optimized files,
  records DB associations, and optionally creates thumbnails. Errors at intermediate steps require cleanup across several local paths and storage/database
  state.
- Safe modification: Keep each stage idempotent, preserve cleanup on every early return/error, and cover failure points as well as success behavior in
  `tests/e2e/media.test.ts` and `tests/unit/media-derivative.test.ts`.
- Test coverage: Existing media and derivative tests are present; cross-boundary crash/restart behavior is not represented by in-process tests.

**Worker pool and DB bridge depend on persistent worker/resource lifecycle:**

- Files: `src/workers/pool.ts`, `src/workers/upload-worker.ts`, `src/db/bridge.ts`, `src/db/proxy.ts`, `main.ts`
- Why fragile: Workers retain MessageChannel or remote DB connections and recurring throughput timers; e2e suites disable op/resource sanitizers to accommodate
  long-lived workers. Shutdown currently initiates pool shutdown, server shutdown, and DB close without awaiting completion.
- Safe modification: Preserve the local-versus-remote DB initialization protocol, cover worker error/restart and shutdown behavior, and await resource shutdown
  before closing the shared DB.
- Test coverage: Upload, mirror, media, and delete e2e tests disable resource sanitization; process-level graceful-shutdown behavior is not covered by these
  route tests.

## Scaling Limits

**Pruning is bounded per cycle but scans with in-memory cursors:**

- Current capacity: Each rule and ownerless pass examines at most configured `prune.batchSize` rows per cycle; the default is documented in
  `src/config/schema.ts` as 1000.
- Limit: Cursor state exists only in the running process (`main.ts` / `src/prune/prune.ts`), so restart begins scans from the start. Large backlogs require
  repeated cycles, and each rule has a separate bounded scan.
- Scaling path: Persist cursors or use durable indexed work queues if prune backlogs become operationally significant; monitor cycle duration and backlog age.

## Dependencies at Risk

**Video optimization depends on host ffmpeg/ffprobe binaries:**

- Risk: Video transcoding and thumbnailing fail when the binaries are unavailable or incompatible with input codecs.
- Impact: `/media` functionality for video depends on host packages and can fail despite the Deno app starting; runtime installation/configuration is outside
  the Deno lockfile.
- Migration plan: Keep the dependency explicit in deployment packaging (`Dockerfile`, `nix/package.nix`); add startup capability checks or an explicit feature
  health signal if video optimization is enabled.

## Missing Critical Features

**No explicit storage/DB reconciliation or durable operation journal:**

- Problem: The database and blob backend cannot be updated atomically, and cleanup failures are generally logged as best effort.
- Blocks: Automatic detection and repair of orphaned blobs, missing objects, and partially completed media/delete operations.

## Test Coverage Gaps

**Crash consistency across database and storage operations:**

- What's not tested: Restart/failure between physical object commit/removal and metadata/derivative row changes, including partial S3 or local-storage failures.
- Files: `src/routes/upload.ts`, `src/routes/media.ts`, `src/routes/delete.ts`, `src/prune/prune.ts`, `src/storage/s3.ts`
- Risk: Data loss, orphaned storage, or broken references may go unnoticed by route-level tests.
- Priority: Medium

**Resource exhaustion under concurrent media and mirror workloads:**

- What's not tested: Bounded native transcoding concurrency, temp-disk exhaustion, and prolonged slow-body mirror requests at pool saturation.
- Files: `src/routes/media.ts`, `src/routes/mirror.ts`, `src/workers/pool.ts`, `src/config/schema.ts`
- Risk: Operators may see request pileups, worker saturation, or disk exhaustion under adversarial or unusually heavy traffic.
- Priority: Medium

---

_Concerns audit: 2026-09-30_
