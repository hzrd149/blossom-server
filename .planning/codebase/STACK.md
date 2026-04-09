# Technology Stack

**Analysis Date:** 2026-04-09

## Languages

**Primary:**
- TypeScript - TypeScript + JSX for server, admin dashboard, and client code

**Secondary:**
- JavaScript - Generated bundle code for client-side landing page
- SQL - Database schema and migrations (LibSQL/SQLite)

## Runtime

**Environment:**
- Deno 2.x (latest) - Primary runtime for all server code, configured via `deno.json`

**Package Manager:**
- JSR (Jsr Registry) - Primary package manager for Deno packages
- NPM - Used for select packages via Deno's npm: protocol (e.g., `npm:sharp`, `npm:nostr-tools`)
- Lockfile: `deno.lock` (present, auto-managed by Deno)

## Frameworks

**Core:**
- Hono 4.12.7 (JSR) - HTTP server framework for routing, middleware, request handling
- JSX (precompile) - Server-side JSX rendering via `@hono/hono/jsx` for admin dashboard and landing page

**Testing:**
- Deno test runner - Built-in Deno testing framework (no external test library required)

**Build/Dev:**
- Deno bundle (--unstable-bundle) - Bundles landing page client JS at server startup
- Deno compile - Supported for static binary generation (not used in production, but configured)
- Sharp 0.34.5 (npm) - Image optimization and transcoding (native bindings included)
- FFmpeg - External system dependency for video optimization; installed in Docker via `apt-get install ffmpeg`

## Key Dependencies

**Critical:**

- `@libsql/client` 0.17.0 (npm) - Database client for both local SQLite and remote Turso/libSQL connections; implements the actual blob and report schema
- `@hono/hono` 4.12.7 (JSR) - HTTP server and middleware framework; implements all BUD-02/04/06/09/11 endpoint handlers
- `zod` 4.3.6 (npm) - Runtime config schema validation; validates `config.yml` at startup
- `nostr-tools` 2.23.3 (npm) - Nostr event parsing and verification (NIP-56 report validation, NIP-19 key conversion, etc.)
- `sharp` 0.34.5 (npm) - Image optimization (resize, format conversion, EXIF stripping)

**Infrastructure:**

- `@bradenmacdonald/s3-lite-client` 0.9.5 (JSR) - S3-compatible object storage client; enables S3/MinIO/DigitalOcean Spaces backend
- `@std/yaml` 1.0.12 (JSR) - YAML config file parsing
- `@std/encoding` 1.0.10 (JSR) - Hex encoding/decoding for hash verification
- `@std/crypto` 1.0.5 (JSR) - SHA-256 hashing for blob integrity verification
- `@std/log` 0.224.14 (JSR) - Structured logging framework
- `@std/path` 1.1.4 (JSR) - Cross-platform path handling
- `@std/ulid` 1.0.0 (JSR) - ULID generation for temp file IDs and blob tracking
- `@std/media-types` 1.1.0 (JSR) - MIME type detection and mapping
- `file-type` 19.6.0 (npm) - Magic bytes file type detection for uploaded blobs
- `applesauce-core`, `applesauce-common`, `applesauce-loaders`, `applesauce-relay` (npm, v5.1.0) - Nostr event handling library ecosystem for admin dashboard profile lookup
- `rxjs` 7.8.0 (npm) - Reactive programming library (used by applesauce for async profile fetching)

## Configuration

**Environment:**
- Configuration via YAML file (`config.yml` by default, configurable via CLI argument)
- Environment variable interpolation: `${VAR_NAME}` syntax in config values at startup (`src/config/loader.ts`)
- Critical env vars: `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `TURSO_AUTH_TOKEN` (referenced in config but not auto-loaded)

**Build:**
- `deno.json` - Deno manifest with tasks, imports, JSR/npm mappings, JSX config
- `.prettierrc` - Formatting rules (minimal config)
- `tsconfig.json` - TypeScript options (not explicitly used, but supported by Deno)
- `docker-compose.yml` - Docker Compose for local development (contains sqld for database testing)
- `Dockerfile` - Multi-stage build using `denoland/deno:debian` base image

## Platform Requirements

**Development:**
- Deno 2.x
- Node.js 22.x (for compatibility, as per `.nvmrc`)
- FFmpeg (if testing video optimization locally)
- Docker (optional, for containerized database/storage testing)

**Production:**
- Deno 2.x runtime
- FFmpeg (installed in Docker as system dependency `apt-get install ffmpeg`)
- S3-compatible object storage (optional, if using S3 backend; local filesystem used by default)
- Remote libSQL/Turso database (optional, if using remote; local SQLite default)
- Filesystem with sufficient space for blob storage (local backend) or S3 bucket access (S3 backend)

**Deployment Target:**
- Docker containers (primary, uses `denoland/deno:debian` image with Debian-based system dependencies)
- Standalone Deno binary (supported via `deno compile`)
- Bare metal (Deno runtime + system FFmpeg installation)

---

*Stack analysis: 2026-04-09*
