# External Integrations

**Analysis Date:** 2026-04-09

## APIs & External Services

**Nostr Relays (admin profile lookup only):**
- Relay Pool for profile metadata - Used by admin dashboard to fetch Nostr kind:0 profile events
  - SDK/Client: `applesauce-relay` (RelayPool)
  - Config: `dashboard.lookupRelays` (array of wss:// URLs, defaults: purplepag.es, index.hzrd149.com, indexer.coracle.social)
  - Authentication: None required (standard Nostr subscription model)
  - Implementation: `src/admin/nostr-profile.ts` — module-level EventStore + RelayPool singletons with RxJS observable batching

**Remote Blob Origins (mirror endpoint):**
- Arbitrary HTTP(S) URLs for mirror operation (BUD-04)
  - SDK/Client: Native Deno `fetch()` with `AbortSignal.timeout`
  - Auth: None (public URLs, potential SSRF guard in place)
  - Implementation: `src/routes/mirror.ts` — validates hostname (SSRF check), fetches with configurable connect/body timeouts, streams to worker
  - Timeouts: `mirror.connectTimeout` (default 30s), `mirror.bodyTimeout` (default 0/unlimited)

## Data Storage

**Databases:**
- LibSQL (local SQLite or remote Turso)
  - Connection: `database.url` (remote libSQL/Turso) OR `database.path` (local SQLite file)
  - Client: `@libsql/client` v0.17.0
  - Auth: `database.authToken` (required for Turso cloud, optional for local sqld)
  - Migrations: Auto-run at startup from `src/db/migrations/*.sql` (001_initial.sql, 002_media_derivatives.sql, 003_reports.sql)
  - Implemented in: `src/db/client.ts` (initialization), `src/db/bridge.ts` (worker bridge), `src/db/direct.ts` (direct handle)

**File Storage:**
- **Local filesystem (default):**
  - Path: `storage.local.dir` (default `./data/blobs`)
  - Implementation: `src/storage/local.ts` — direct file I/O via Deno filesystem APIs
  - Implemented in: `src/storage/local.ts`

- **S3-compatible object storage (optional):**
  - Endpoint: `storage.s3.endpoint` (e.g., `https://s3.amazonaws.com`, MinIO, DigitalOcean Spaces)
  - Bucket: `storage.s3.bucket`
  - Credentials: `storage.s3.accessKey`, `storage.s3.secretKey` (support `${ENV_VAR}` interpolation)
  - Region: `storage.s3.region` (optional, defaults to `us-east-1`)
  - Public redirect URL: `storage.s3.publicURL` (optional, GET /:sha256 redirects instead of proxying)
  - Temp buffer: `storage.s3.tmpDir` (default `./data/s3-tmp`, must have sufficient free space for largest upload)
  - Client: `@bradenmacdonald/s3-lite-client` v0.9.5 (uses path-style URLs for MinIO compatibility)
  - Implemented in: `src/storage/s3.ts`

**Caching:**
- None — all reads hit storage directly (local filesystem or S3)

## Authentication & Identity

**Auth Provider:**
- Custom Nostr (NIP-11, NIP-56) — no external provider
  - Implementation: `src/middleware/auth.ts` — BUD-11 event validation (signature verification via nostr-tools)
  - Approach: Clients send signed Nostr events (`kind: 27235`) in `Authorization: Bearer` header or `X-Auth-Event` JSON; server verifies signature and pubkey match event content
  - Config: `upload.requireAuth`, `delete.requireAuth`, `media.requireAuth`, `mirror.requireAuth` (all boolean, default true for write operations)

**Admin Dashboard:**
- HTTP Basic Auth
  - Credentials: `dashboard.username`, `dashboard.password`
  - Password generation: Auto-generated and logged at startup if blank
  - Implementation: `src/admin/layout.tsx` + Hono basicAuth middleware
  - Protected endpoints: `/admin` (pages), `/api` (admin API calls)

## Monitoring & Observability

**Error Tracking:**
- Not detected — no Sentry, Rollbar, etc. integration

**Logs:**
- Console logging via `@std/log` (Deno std library logger)
- Debug flag: `Deno.env.get("DEBUG")` for verbose output in `src/middleware/debug.ts`
- Implementation: Request logging in `src/middleware/logger.ts`, error handling in `src/middleware/errors.ts`
- Key log points: startup (config, DB, storage ready), upload worker status, prune cycle results, errors

## CI/CD & Deployment

**Hosting:**
- Docker (primary deployment target)
  - Base image: `denoland/deno:debian` (includes Deno runtime, FFmpeg pre-installed for video)
  - Image entrypoint: `deno task start` (defined in deno.json)
  - Volume mount: `/app/data` (SQLite DB + blob storage)

**CI Pipeline:**
- Not detected in codebase (likely GitHub Actions via `.github/workflows/`, not examined)

## Environment Configuration

**Required env vars:**
- `S3_ACCESS_KEY` - S3 access key ID (if using S3 backend)
- `S3_SECRET_KEY` - S3 secret access key (if using S3 backend)
- `TURSO_AUTH_TOKEN` - Turso cloud auth token (if using remote libSQL on Turso)
- `DEBUG` - Optional, set to any truthy value to enable debug logging

**Secrets location:**
- Secrets are NOT stored in the codebase — they are provided via environment variables at runtime
- Config file (`config.yml`) supports `${VAR_NAME}` interpolation for reading env vars
- Typical setup: `.env` file (git-ignored) loaded via Deno's `--env-file` flag, or secrets injected by deployment system (Docker, Kubernetes, etc.)

## Webhooks & Callbacks

**Incoming:**
- None — Blossom Server is a blob storage API, does not accept webhooks

**Outgoing:**
- None — Server does not make proactive callbacks to external systems
- One-way integrations: Mirror (pull blobs from origins), Nostr relays (fetch user profiles for admin lookup)

---

*Integration audit: 2026-04-09*
