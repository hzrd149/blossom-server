# External Integrations

**Analysis Date:** 2026-09-30

## APIs & External Services

**Blob storage:**

- S3-compatible object storage (AWS S3, MinIO, or compatible service) - optional `storage.backend: s3`; verified on startup, and receives blobs only after local
  buffering and SHA-256 verification (`src/storage/s3.ts`, `main.ts`).
  - SDK/Client: `@bradenmacdonald/s3-lite-client`.
  - Auth: `storage.s3.accessKey` and `storage.s3.secretKey`, normally supplied by YAML `${ENV_VAR}` interpolation; optional `region`.
- Remote mirror origins - BUD-04 accepts a remote URL, resolves and validates its destination, then fetches and streams the remote blob (`src/routes/mirror.ts`,
  `src/utils/ip-guard.ts`). This is a user-selected outbound HTTP(S) integration; it is not restricted to one provider.
  - SDK/Client: Deno/Fetch API (`fetch`) with DNS lookup through `node:dns/promises`.
  - Auth: none for origin fetches; Blossom BUD-11 auth can be required for clients calling the mirror endpoint.
- Optional public object/CDN URL - `storage.s3.publicURL` makes blob GET requests redirect to a configured public URL prefix instead of proxying from S3
  (`src/storage/s3.ts`, `src/routes/blobs.ts`).

**Nostr network:**

- Configured Nostr relays - admin user pages retrieve kind:0 profile metadata through WebSocket relay queries; defaults are `wss://purplepag.es`,
  `wss://index.hzrd149.com`, and `wss://indexer.coracle.social` (`src/admin/nostr-profile.ts`, `src/config/schema.ts`). Set `dashboard.lookupRelays: []` to
  disable lookup.
  - SDK/Client: `applesauce-relay`, `applesauce-core`, `applesauce-loaders`, `applesauce-common`, and `rxjs`.
  - Auth: public relay reads; no relay credentials are configured.
- Blossom/Nostr clients - protocol auth validates signed kind 24242 events locally, while report submissions validate signed kind 1984 events
  (`src/middleware/auth.ts`, `src/routes/report.ts`). These are cryptographic protocol integrations, not calls to a centralized identity service.
  - SDK/Client: `nostr-tools`.
  - Auth: Nostr event signatures and BUD-11 tags; browser signing can use a NIP-07 extension, NIP-46 remote signer, or a browser-generated local key
    (`src/landing/client/identity.ts`).

## Data Storage

**Databases:**

- SQLite/libSQL - local embedded database by default; can use a remote libSQL endpoint such as Turso or local `sqld` when `database.url` is set
  (`src/db/client.ts`, `src/config/schema.ts`).
  - Connection: `database.path` for local files; `database.url` and optional `database.authToken` for remote access. `database.authToken` is intended for Turso
    cloud.
  - Client: `@libsql/client`; local SQLite uses its `sqlite3` entrypoint. Migrations live in `src/db/migrations/`.

**File Storage:**

- Local filesystem by default (`storage.local.dir`, default `./data/blobs`; `src/storage/local.ts`).
- Optional S3-compatible storage (`src/storage/s3.ts`); upload staging occurs in local `storage.s3.tmpDir` before commit.
- Media optimization and temporary files use local filesystem storage (`media.tmpDir`).

**Caching:**

- No external cache detected. Dashboard Nostr profile metadata uses an in-process `EventStore` (`src/admin/nostr-profile.ts`).

## Authentication & Identity

**Auth Provider:**

- Blossom BUD-11 Nostr signed events - verified locally with `nostr-tools`; configured per route family with `requireAuth` options (`src/middleware/auth.ts`,
  `src/config/schema.ts`). There is no centralized auth provider.
- Admin dashboard HTTP Basic Auth - Hono `basicAuth`, enabled/configured with `dashboard.enabled`, `dashboard.username`, and `dashboard.password`
  (`src/routes/admin-router.tsx`). A blank password is generated at startup and logged by `main.ts`.
- Browser identity - generated local Nostr key by default, with optional NIP-07 browser extension or NIP-46 remote signer (`src/landing/client/identity.ts`,
  `src/landing/client/auth.ts`).

## Monitoring & Observability

**Error Tracking:**

- Not detected.

**Logs:**

- Console/stdout logging for startup, request logs, pruning, warnings, and errors (`main.ts`, `src/middleware/logger.ts`, `src/middleware/debug.ts`). `DEBUG`
  enables additional debug messages.

## CI/CD & Deployment

**Hosting:**

- No single hosted runtime is assumed. Docker image targets `ghcr.io` and supports amd64/arm64 (`Dockerfile`, `.github/workflows/`). A Nix package and NixOS
  module are also provided (`flake.nix`, `nix/`).

**CI Pipeline:**

- GitHub Actions builds Docker images and runs Nix flake checks (`.github/workflows/`).

## Environment Configuration

**Required env vars:**

- No fixed environment-variable set is required. YAML values can reference deployment-provided variables using `${VAR_NAME}` in `config.yml`
  (`src/config/loader.ts`).
- `BLOSSOM_REQUIRE_CONFIG` - set to `1`, `true`, or `yes` to refuse startup when the config file is absent.
- `DEBUG` - enables debug logging when set.
- Deployment examples use `TURSO_AUTH_TOKEN`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` through config interpolation (`config.example.yml`, `README.md`).

**Secrets location:**

- Secrets are injected into YAML config at runtime via `${ENV_VAR}`. The repository contains `config.example.yml`; actual config and deployment secret storage
  are operator-managed.

## Webhooks & Callbacks

**Incoming:**

- None detected. Blossom HTTP endpoints are protocol routes, not webhook receivers.

**Outgoing:**

- No webhook delivery detected. Outbound network calls are Nostr relay profile lookups (`src/admin/nostr-profile.ts`), user-requested mirror fetches
  (`src/routes/mirror.ts`), remote database traffic, and S3 object operations (`src/db/client.ts`, `src/storage/s3.ts`).

---

_Integration audit: 2026-09-30_
