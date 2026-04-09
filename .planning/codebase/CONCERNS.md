# Codebase Concerns

**Analysis Date:** 2026-04-09

## Tech Debt

**Deprecated `fetchTimeout` config parameter:**
- Issue: The `fetchTimeout` parameter in mirror config is deprecated in favor of `connectTimeout`. A `.transform()` shim promotes the old value when the new one is absent.
- Files: `src/config/schema.ts` (lines 331-363)
- Impact: Adds complexity to config parsing; confusing for new operators who may use the old name.
- Fix approach: Remove `fetchTimeout` from the schema after a deprecation period. Add a startup warning when the deprecated key is detected.

**Deprecated `databasePath` top-level config key:**
- Issue: The old `databasePath` top-level key is merged into `database.path` via a `.transform()` shim at config parse time.
- Files: `src/config/schema.ts` (lines 546-557)
- Impact: Same as above -- schema complexity, potential confusion.
- Fix approach: Remove `databasePath` from the schema after a deprecation period. Warn on startup if present.

**Legacy Node.js database migration code (313 lines):**
- Issue: `maybeMigrateLegacyDb()` runs on every startup to detect and migrate a legacy Node.js blossom-server SQLite schema. The detection heuristic uses a regex `/\bid\b/` on the `CREATE TABLE` SQL from `sqlite_master`, which could false-positive on column names or comments containing "id".
- Files: `src/db/legacy-migration.ts` (entire file, 313 lines), called from `main.ts`
- Impact: Dead code weight after all deployments have migrated. The regex heuristic (line 100) is fragile -- any schema with an `id` substring in the `owners` table DDL triggers migration.
- Fix approach: As documented in the file header (lines 36-39): delete the file, remove the import from `main.ts`, remove the `migrate-from-legacy` deno.json task.

**Duplicated `mimeToExt()` helper:**
- Issue: `mimeToExt()` is defined identically in three places: `src/utils/mime.ts`, `src/routes/media.ts` (line 79-82), and `src/routes/delete.ts` (line 33-36).
- Files: `src/utils/mime.ts`, `src/routes/media.ts`, `src/routes/delete.ts`
- Impact: Bug risk if one copy is updated and others are not. The upload and blobs routes already import from `src/utils/mime.ts`.
- Fix approach: Remove the local definitions in `media.ts` and `delete.ts`; import from `src/utils/mime.ts` instead.

**Duplicated `BlobDescriptor` type:**
- Issue: The `BlobDescriptor` interface is defined locally in `src/routes/upload.ts` (line 44), `src/routes/mirror.ts` (line 54), and `src/routes/media.ts` (line 67). Identical shape in all three.
- Files: `src/routes/upload.ts`, `src/routes/mirror.ts`, `src/routes/media.ts`
- Impact: Maintenance burden; divergence risk.
- Fix approach: Extract to a shared types file (e.g. `src/types.ts` or `src/routes/types.ts`).

## Security Considerations

**SSRF protection does not prevent DNS rebinding:**
- Risk: The mirror endpoint's SSRF guard (`checkSsrf()` in `src/routes/mirror.ts` lines 98-106) only blocks literal private IP addresses in the URL hostname. A hostname that resolves to a private IP at fetch time bypasses the check entirely. The code comments acknowledge this explicitly (line 93-95): "Hostname-based DNS rebinding is out of scope."
- Files: `src/routes/mirror.ts` (lines 67-106)
- Current mitigation: Connect timeout (`config.mirror.connectTimeout`) limits exposure window.
- Recommendations: Resolve the hostname before fetching and validate the resolved IP against private ranges. Alternatively, use Deno's `--allow-net` permission scoping to restrict outbound connections.

**Anonymous uploads when auth is disabled:**
- Risk: When `config.upload.requireAuth` is `false`, any client can upload blobs without authentication. The uploader pubkey defaults to the string `"anonymous"` (see `src/routes/upload.ts` line 406, `src/routes/mirror.ts` line 531, `src/routes/media.ts` line 511).
- Files: `src/routes/upload.ts` (line 406), `src/routes/mirror.ts` (line 531), `src/routes/media.ts` (line 511)
- Current mitigation: Auth is enabled by default in the config schema (`requireAuth: z.boolean().default(true)`).
- Recommendations: Add rate limiting per IP when auth is disabled. Consider adding a warning at startup when auth is disabled.

**Unauthenticated delete when `delete.requireAuth` is false:**
- Risk: When `config.delete.requireAuth` is `false`, any client can delete any blob without ownership verification. The code at `src/routes/delete.ts` lines 63-74 skips all auth and ownership checks.
- Files: `src/routes/delete.ts` (lines 63-74, 87-98)
- Current mitigation: Auth is enabled by default (`requireAuth: z.boolean().default(true)`).
- Recommendations: Add a config-level warning if delete auth is disabled.

**S3 credentials in YAML config:**
- Risk: S3 `accessKey` and `secretKey` are defined directly in the config YAML schema. While the schema description mentions `${ENV_VAR}` syntax, there is no enforcement -- operators may paste credentials directly into `config.yml`.
- Files: `src/config/schema.ts` (lines 38-43), `config.example.yml`
- Current mitigation: Documentation suggests env var syntax.
- Recommendations: Add a startup warning if S3 credentials appear to be literal values (not `${...}` references). Add `config.yml` to `.gitignore` if not already present.

**Auth middleware silently swallows parse errors:**
- Risk: In `authMiddleware()` at `src/middleware/auth.ts` lines 156-161, when auth header parsing fails with an `HTTPException`, the error is silently swallowed and `auth` is left `undefined`. This means a request with a malformed auth header is treated as unauthenticated rather than rejected. For routes where auth is optional, a bad token silently degrades to anonymous access.
- Files: `src/middleware/auth.ts` (lines 156-161)
- Current mitigation: Routes that require auth call `requireAuth()` which throws 401 if auth is undefined.
- Recommendations: Consider logging malformed auth attempts for audit purposes beyond just `console.warn`.

## Performance Bottlenecks

**FFmpeg video transcoding runs as a subprocess with no resource limits:**
- Problem: `optimizeVideo()` spawns `ffmpeg` via `Deno.Command` with no CPU/memory limits, no timeout, and no concurrent transcoding cap. A single large video can consume all CPU cores for minutes.
- Files: `src/optimize/video.ts` (lines 78-128)
- Cause: `Deno.Command` does not support resource limits. There is no timeout on `cmd.output()`.
- Improvement path: Add a configurable timeout via `AbortSignal` on the ffmpeg process. Limit concurrent transcoding jobs with a semaphore. Consider using `nice` or `cgroup` constraints.

**S3 `beginWrite()` polls file size every 100ms as a fallback:**
- Problem: Both `S3Storage.beginWrite()` and `LocalStorage.beginWrite()` have a fallback path that polls `Deno.stat()` every 100ms via `setInterval` to detect when writing is complete. This fires repeatedly during every upload.
- Files: `src/storage/s3.ts` (lines 194-209), `src/storage/local.ts` (lines 109-125)
- Cause: The `writable.closed` promise may not be available on all runtimes. The polling fallback was added as a safety net.
- Improvement path: Verify that Deno's `file.writable` always provides `.closed`. If so, remove the polling fallback. If not, use a more efficient signaling mechanism (e.g., resolve from `pipeTo()` completion).

**Admin dashboard profile lookups are individually timeout-bounded but lack a global cap:**
- Problem: `fetchUserProfiles()` launches one relay query per pubkey, each with a 4-second timeout. With many unique uploaders, the admin page blocks for up to `4000 + 500 = 4500ms` regardless of how many pubkeys are queried.
- Files: `src/admin/nostr-profile.ts` (lines 67-92)
- Cause: `loadAsyncMap()` is called with `timeout + 500` (4500ms). All lookups run in parallel, but the overall call blocks until the slowest one finishes or times out.
- Improvement path: Add a configurable global timeout. Paginate or lazy-load profiles on the admin dashboard instead of fetching all at once.

## Fragile Areas

**Worker pool has no job timeout -- hung jobs permanently consume capacity:**
- Files: `src/workers/pool.ts` (lines 85-239)
- Why fragile: The `PendingJob` promise is only resolved or rejected when the worker posts a message back. If a worker hangs (e.g., disk I/O stall, corrupted stream), the pending promise never settles. The `jobCount` stays incremented, permanently reducing pool capacity. The `onerror` handler (lines 155-159) only decrements by 1 and doesn't know which job failed, so it cannot reject the correct pending promise.
- Safe modification: Add a per-job timeout in `dispatch()` that rejects the pending promise and decrements `jobCount` after a configurable deadline. Clean up the temp file on timeout.
- Test coverage: No tests exist for the worker pool at all.

**Legacy migration schema detection uses regex heuristic:**
- Files: `src/db/legacy-migration.ts` (line 100)
- Why fragile: The detection regex `/\bid\b/` is applied to the raw `CREATE TABLE` SQL text. It could match column comments, constraint names, or other identifiers containing "id" as a word. A false positive would trigger destructive migration on a valid Deno-schema database.
- Safe modification: Use a more specific check, e.g., parse the column list or check for `AUTOINCREMENT` which is unique to the legacy schema.
- Test coverage: No tests.

**Storage `beginWrite()` polling fallback may never resolve:**
- Files: `src/storage/s3.ts` (lines 194-209), `src/storage/local.ts` (lines 109-125)
- Why fragile: If `sizeHint` is `null` (unknown content length), the polling fallback never resolves because the condition `stat.size >= sizeHint` is never checked (guarded by `sizeHint !== null`). The `done` promise hangs forever. This is safe only because the `done` promise is not actually awaited in the current upload pipeline -- the worker writes directly to `tmpPath`, not through `writable`. But any future code that awaits `session.done` with an unknown size will deadlock.
- Safe modification: Document clearly that `done` is unreliable when `sizeHint` is null, or replace the polling mechanism entirely.
- Test coverage: No tests.

## Scaling Limits

**Worker pool has no queue -- immediate 503 when all slots are full:**
- Current capacity: `navigator.hardwareConcurrency` workers (default), each handling `maxJobsPerWorker` concurrent jobs (default not visible in config defaults, likely 1-4).
- Limit: When all worker slots are occupied, `dispatch()` returns `null` and the route immediately returns 503. There is no request queue, backpressure, or retry mechanism.
- Scaling path: Add a bounded queue with configurable depth. Alternatively, document that operators should use a reverse proxy (nginx, Caddy) with request queuing. Consider scaling horizontally behind a load balancer.
- Files: `src/workers/pool.ts` (lines 204-213)

**SQLite write contention under concurrent uploads:**
- Current capacity: Single SQLite file with WAL mode. WAL allows concurrent reads but serializes writes.
- Limit: Under heavy upload load, `insertBlob()` (which uses `db.batch()` with 3 statements) contends with `touchBlob()` fire-and-forget writes from GET requests. SQLite's write lock timeout defaults to 5 seconds.
- Scaling path: Use remote libSQL/Turso (already supported via `DbConfig.url`). Batch `touchBlob()` writes with debouncing. Consider using `PRAGMA busy_timeout` explicitly.
- Files: `src/db/client.ts`, `src/db/blobs.ts`

**No rate limiting on any endpoint:**
- Current capacity: Unlimited requests per second from any IP.
- Limit: A single client can exhaust server resources by flooding upload, mirror, or media endpoints. Even with auth enabled, a valid auth token grants unlimited access.
- Scaling path: Add per-IP and per-pubkey rate limiting middleware. Use a token bucket or sliding window algorithm. Many Hono middleware options exist.
- Files: `src/server.ts` (no rate limiting middleware registered)

**No request audit logging:**
- Current capacity: Request logger at `src/middleware/logger.ts` logs method/path/status/latency but not client identity (pubkey) or uploaded blob hash.
- Limit: No ability to trace abuse, identify heavy uploaders, or investigate incidents.
- Scaling path: Extend the request logger to include auth pubkey (when available) and blob hash for upload/mirror/media/delete operations.
- Files: `src/middleware/logger.ts`

## Dependencies at Risk

**`@bradenmacdonald/s3-lite-client` -- niche S3 client:**
- Risk: Single-maintainer package with a relatively small user base compared to the official AWS SDK. If abandoned, S3 support depends on a potentially unmaintained client.
- Impact: S3 storage backend (`src/storage/s3.ts`) depends entirely on this client.
- Migration plan: Replace with `@aws-sdk/client-s3` (official AWS SDK) or `minio-js` (well-maintained, S3-compatible).

**`applesauce-*` packages for Nostr profile lookups:**
- Risk: Multiple `applesauce-*` packages (`applesauce-common`, `applesauce-core`, `applesauce-loaders`, `applesauce-relay`) are used solely for admin dashboard profile lookups. These are specialized Nostr ecosystem packages.
- Impact: Only affects admin dashboard (`src/admin/nostr-profile.ts`). Core functionality is unaffected.
- Migration plan: Could be replaced with direct NIP-01 relay queries using `nostr-tools` (already a dependency).

## Test Coverage Gaps

**No test files exist in the project:**
- What's not tested: The entire codebase. There are zero test files in `src/` or anywhere outside `node_modules/`.
- Files: All of `src/`
- Risk: Any refactoring or feature change can introduce regressions with no safety net. Critical paths that most urgently need testing:
  - **Worker pool dispatch/completion/error handling** (`src/workers/pool.ts`) -- hung jobs, capacity tracking, error recovery
  - **Upload hash verification** (`src/workers/upload-worker.ts`) -- hash mismatch, stream errors, partial writes
  - **S3 storage write/commit/abort cycle** (`src/storage/s3.ts`) -- commit failures, dedup races, temp file cleanup
  - **Auth middleware parsing** (`src/middleware/auth.ts`) -- malformed headers, expired tokens, domain validation
  - **Mirror SSRF guard** (`src/routes/mirror.ts`) -- private IP detection, IPv6, edge cases
  - **Database atomicity** (`src/db/blobs.ts`) -- concurrent inserts, owner dedup, batch failures
  - **Media optimization error paths** (`src/optimize/index.ts`) -- ffmpeg failures, sharp errors, partial output cleanup
  - **Legacy migration** (`src/db/legacy-migration.ts`) -- schema detection accuracy, backup/restore on failure
  - **Config schema validation** (`src/config/schema.ts`) -- deprecated field migration, S3 credential handling
- Priority: High -- this is the single largest risk factor in the codebase.

---

*Concerns audit: 2026-04-09*
