# Technology Stack

**Analysis Date:** 2026-09-30

## Languages

**Primary:**

- TypeScript (Deno ESM) - HTTP server, protocol routes, storage/database adapters, workers, and client-side landing page in `main.ts` and `src/`.

**Secondary:**

- SQL (SQLite/libSQL migrations) - schema and indexes in `src/db/migrations/`.
- CSS/Tailwind input - landing/admin styling in `src/landing/styles/` and `tailwind.config.js`.
- Nix - reproducible package and NixOS module in `flake.nix` and `nix/`.

## Runtime

**Environment:**

- Deno 2 - server runtime, TypeScript execution, workers, test runner, formatter, linter, and bundler. `deno.json` declares the application as
  `@hzrd149/blossom-server` version `6.4.0`.
- Node compatibility is used through Deno's `npm:` imports for native and ecosystem packages; native `sharp` and SQLite binaries require a glibc environment in
  the provided Docker build (`Dockerfile`).

**Package Manager:**

- Deno module graph with JSR and npm specifiers declared in `deno.json`.
- Lockfile: `deno.lock`; separate locked graphs exist for `src/landing/client/` and `src/landing/styles/`.

## Frameworks

**Core:**

- Hono `^4.12.7` - HTTP routing, middleware, CORS, static serving, Basic Auth, and JSX SSR (`src/server.ts`, `src/routes/`).
- Hono JSX - server-rendered admin and landing pages plus the browser hydration bundle (`src/admin/`, `src/landing/`).
- Zod `^4.3.6` - configuration schema, defaults, and inferred configuration types (`src/config/schema.ts`).

**Testing:**

- Deno test runner with `@std/assert` `1.x` - unit, client identity, and Hono `app.fetch()` end-to-end tests under `tests/` and
  `src/landing/client/identity.test.ts`.

**Build/Dev:**

- Deno tasks - development, startup, tests, bundling, and formatting/linting (`deno.json`).
- Tailwind CSS `3.4.17` - generates `public/styles.css` (`src/landing/styles/deno.json`).
- `deno bundle` - creates browser-targeted `public/client.js` from `src/landing/client/index.tsx`.
- Nix flakes and `deno2nix` - package, fixed-output dependency realization, and NixOS module (`flake.nix`, `nix/package.nix`).
- Docker with `denoland/deno:debian` - container build pre-caches modules, compiles landing assets, and installs ffmpeg (`Dockerfile`).

## Key Dependencies

**Critical:**

- `@libsql/client` `^0.17.0` - local SQLite and remote libSQL/Turso database access (`src/db/client.ts`).
- `@bradenmacdonald/s3-lite-client` `^0.9.5` - S3-compatible blob backend (`src/storage/s3.ts`).
- `nostr-tools` `^2.23.3` - BUD-11 event signature verification, Nostr encoding, and browser signing (`src/middleware/auth.ts`, `src/routes/report.ts`,
  `src/landing/client/`).
- `@std/yaml` `^1.0.12` - YAML config parsing (`src/config/loader.ts`).
- `sharp` `~0.35.3` - image optimization, metadata, and image thumbnails; loaded lazily (`src/optimize/`).
- `file-type` `^19.6.0` - content type detection for media handling (`src/optimize/`).

**Infrastructure:**

- Deno standard modules `@std/crypto`, `@std/encoding`, `@std/media-types`, `@std/path`, and `@std/ulid` - hashing/encoding, MIME mappings, path handling, and
  identifiers.
- `applesauce-common`, `applesauce-core`, `applesauce-loaders`, `applesauce-relay` `^6.2.0` and `rxjs` `^7.8.0` - Nostr relay profile lookup in the dashboard
  (`src/admin/nostr-profile.ts`).
- Host `ffmpeg` and `ffprobe` executables - video transcoding and thumbnail extraction (`src/optimize/video.ts`, `src/optimize/thumbnail.ts`).

## Configuration

**Environment:**

- Primary configuration is YAML loaded from `config.yml` or the first CLI argument and validated/defaulted by `src/config/schema.ts` and `src/config/loader.ts`.
- `${ENV_VAR}` interpolation is supported for YAML scalar values. `BLOSSOM_REQUIRE_CONFIG` enables strict missing-config behavior; `DEBUG` enables debug
  logging.
- No `.env` file is required by the application config model; Deno task commands optionally load `.env` (`deno.json`).

**Build:**

- `deno.json` - import map, tasks, JSX compiler settings, runtime permissions, and formatting width.
- `deno.lock` plus scoped client/style Deno config and lockfiles - pinned dependency graphs.
- `tailwind.config.js` - CSS generation settings; `Dockerfile` and `flake.nix` package assets before runtime.

## Platform Requirements

**Development:**

- Deno 2 and a writable local data directory; install `ffmpeg`/`ffprobe` to use video processing.
- `deno task build` creates `public/client.js` and `public/styles.css`; missing assets produce startup warnings while API routes remain available.

**Production:**

- Runs with Deno 2 using filesystem, network, environment, FFI, system, and subprocess permissions from `deno.json`.
- Supported deployment artifacts include Debian-based Deno Docker images (`Dockerfile`) and Nix packages (x86_64-linux flake output in `flake.nix`). SQLite and
  local blob storage require persistent writable storage; S3 mode also requires a local temporary buffer directory.

---

_Stack analysis: 2026-09-30_
