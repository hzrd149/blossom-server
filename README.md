# Blossom Server

A content-addressed blob storage server implementing the
[Blossom](https://github.com/hzrd149/blossom) protocol. Files are stored and
retrieved by their SHA-256 hash. Built with [Deno 2](https://deno.com),
[Hono](https://hono.dev), and [LibSQL](https://turso.tech/libsql).

## Features

- **BUD-01** — Blob retrieval (`GET`/`HEAD /:sha256`) with range requests,
  ETag/304, and CORS
- **BUD-02** — Upload (`PUT /upload`), delete (`DELETE /:sha256`), and list
  (`GET /list/:pubkey`)
- **BUD-04** — Server-side mirror (`PUT /mirror`) with SSRF protection
- **BUD-05** — Media optimisation (`PUT /media`): image resize/convert via
  sharp, video transcode via ffmpeg
- **BUD-06** — Upload preflight (`HEAD /upload`) to check size, type, and pool
  availability before sending the body
- **BUD-08** — `nip94` field in all blob descriptor responses
- **BUD-11** — Nostr-signed event authentication (kind 24242)
- Zero-copy streaming uploads — no body buffering, SHA-256 computed in a
  dedicated worker pool
- Content-addressed deduplication — re-uploading an existing hash skips the
  write
- Configurable storage retention rules with MIME-type glob patterns and
  per-pubkey scoping
- Automatic prune loop — expired blobs are removed on a configurable timer
- Local filesystem and S3-compatible storage backends
- Optional React Admin dashboard at `/admin`
- Optional server-rendered landing page at `/`
- Docker-ready with a two-stage Dockerfile and health check

## Requirements

- **Docker + Docker Compose** (recommended)
- **or** [Deno 2.x](https://docs.deno.com/runtime/getting_started/installation/)
  for running from source

## Quick Start — Docker

```sh
# 1. Copy and edit the config
cp config.example.yml config.yml

# 2. Set at minimum: port, publicDomain, and storage backend
#    (see Configuration below)

# 3. Start the server
docker compose up --build
```

The server listens on port `3000` by default. Blob data and the SQLite database
are stored in a named Docker volume (`data`). The config file is mounted
read-only from the host.

## Quick Start — From Source

```sh
# 1. Clone the repo
git clone https://github.com/your-org/blossom-server.git
cd blossom-server

# 2. Copy and edit the config
cp config.example.yml config.yml

# 3. Start in development mode (file-watching)
deno task dev
```

For production:

```sh
deno task start
```

Pass a custom config path as the first argument:

```sh
deno task start /etc/blossom/config.yml
```

## Configuration

Configuration is loaded from a YAML file (default: `config.yml` in the working
directory). Environment variables can be substituted anywhere in the file using
`${VAR_NAME}` syntax.

### Key Options

| Key                  | Default          | Description                                                                                                       |
| -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `port`               | `3000`           | TCP port to listen on                                                                                             |
| `host`               | `0.0.0.0`        | Bind interface (`127.0.0.1` for loopback-only behind a proxy)                                                     |
| `publicDomain`       | _(Host header)_  | Full URL used in blob descriptor `url` fields and BUD-11 server-tag validation (e.g. `https://blobs.example.com`) |
| `database.path`      | `data/sqlite.db` | Local SQLite database path                                                                                        |
| `database.url`       | —                | Remote libSQL/Turso URL (`libsql://your-db.turso.io` or `http://localhost:8080`)                                  |
| `storage.backend`    | `local`          | Storage backend: `local` or `s3`                                                                                  |
| `storage.local.dir`  | `./data/blobs`   | Directory for blob files (local backend)                                                                          |
| `upload.enabled`     | `true`           | Enable `PUT /upload`                                                                                              |
| `upload.requireAuth` | `true`           | Require Nostr auth for uploads                                                                                    |
| `upload.maxSize`     | `2147483648`     | Maximum upload size in bytes (2 GB)                                                                               |
| `mirror.enabled`     | `true`           | Enable `PUT /mirror` (BUD-04)                                                                                     |
| `media.enabled`      | `false`          | Enable `PUT /media` (BUD-05); requires ffmpeg for video                                                           |
| `dashboard.enabled`  | `false`          | Enable the React Admin dashboard at `/admin`                                                                      |
| `landing.enabled`    | `false`          | Enable the landing page at `/`                                                                                    |

For all options with inline documentation, see
[`config.example.yml`](config.example.yml).

### S3 Storage Backend

```yaml
storage:
  backend: s3
  s3:
    endpoint: https://s3.amazonaws.com
    bucket: my-blossom-bucket
    accessKey: "${S3_ACCESS_KEY}"
    secretKey: "${S3_SECRET_KEY}"
    region: us-east-1
    # Optional: redirect GET requests to this URL prefix instead of proxying
    # publicURL: https://my-bucket.s3.amazonaws.com/
    # Local buffer directory for uploads before committing to S3
    tmpDir: ./data/s3-tmp
```

### Storage Retention Rules

Rules serve as both an upload allowlist and a retention policy. The first
matching rule governs a blob's expiry. When the list is non-empty, blobs whose
MIME type matches no rule are rejected with `415 Unsupported Media Type`.

```yaml
storage:
  rules:
    - type: "image/*"
      expiration: 1 month
    - type: "video/*"
      expiration: 1 week
    - type: "*"
      expiration: 1 week
```

Rules can be scoped to specific Nostr pubkeys (hex) to give certain users
different retention:

```yaml
storage:
  rules:
    - type: "image/*"
      expiration: 1 year
      pubkeys:
        - "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
    - type: "image/*"
      expiration: 1 month
    - type: "*"
      expiration: 1 week
```

## Authentication (BUD-11)

All authenticated endpoints expect a Nostr-signed event in the `Authorization`
header:

```
Authorization: Nostr <base64-encoded-JSON-event>
```

The event must be **kind 24242** and include:

| Tag          | Required | Description                                                    |
| ------------ | -------- | -------------------------------------------------------------- |
| `t`          | Yes      | Verb for this token: `upload`, `delete`, `get`, or `list`      |
| `expiration` | Yes      | Unix timestamp after which the token is invalid                |
| `x`          | No       | One or more SHA-256 hashes scoping the token to specific blobs |
| `server`     | No       | Hostname(s) this token is valid for                            |

Example event (before signing):

```json
{
  "kind": 24242,
  "content": "Authorize upload",
  "tags": [
    ["t", "upload"],
    ["expiration", "1735689600"],
    ["server", "blobs.example.com"]
  ],
  "created_at": 1704067200
}
```

## API Reference

### Blob Endpoints (BUD-01 / BUD-02)

| Method   | Path             | Auth       | Description                                                                                                                                           |
| -------- | ---------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/:sha256[.ext]` | Optional   | Download a blob by its SHA-256 hash. Extension is advisory. Supports `Range`, `If-None-Match`.                                                        |
| `HEAD`   | `/:sha256[.ext]` | Optional   | Same as GET without the body.                                                                                                                         |
| `PUT`    | `/upload`        | Required\* | Upload a blob. `Content-Length` is required. Returns a `BlobDescriptor`.                                                                              |
| `HEAD`   | `/upload`        | Required\* | Preflight check (BUD-06). Send `X-Content-Length`, `X-Content-Type`, `X-SHA-256` to verify the server will accept the upload before sending the body. |
| `DELETE` | `/:sha256`       | Required\* | Delete a blob. Ownership-gated: the file is removed only when the last owner deletes it.                                                              |
| `GET`    | `/list/:pubkey`  | Required\* | List blobs uploaded by a pubkey.                                                                                                                      |

### Mirror Endpoint (BUD-04)

| Method | Path      | Auth       | Description                                                                                    |
| ------ | --------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `PUT`  | `/mirror` | Required\* | Fetch a remote blob and store it locally. JSON body: `{ "url": "https://..." }`. SSRF-guarded. |

### Media Endpoint (BUD-05)

| Method | Path     | Auth       | Description                                                                                             |
| ------ | -------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `PUT`  | `/media` | Required\* | Upload an image or video; the server optimises/transcodes it and returns the optimised blob descriptor. |
| `HEAD` | `/media` | Required\* | Preflight check for the media endpoint.                                                                 |

_\* Auth requirement is configurable per-endpoint via `requireAuth` in the
config._

### Response Format

Successful upload, mirror, and media responses return a `BlobDescriptor`:

```json
{
  "sha256": "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553",
  "size": 184292,
  "type": "image/jpeg",
  "url": "https://blobs.example.com/b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553.jpg",
  "uploaded": 1704067200,
  "nip94": {
    "tags": [
      ["url", "..."],
      ["x", "..."],
      ["size", "..."],
      ["m", "..."]
    ]
  }
}
```

## Admin Dashboard

Enable the React Admin dashboard to manage blobs and users through a web UI:

```yaml
dashboard:
  enabled: true
  username: admin
  password: "" # Auto-generated and logged to stdout on first startup if blank
```

The dashboard is available at `http://localhost:3000/admin`.

## Development

```sh
# Start with file-watching
deno task dev

# Run the test suite
deno task test

# Run a single test file
deno test --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/unit/auth.test.ts

# Build the frontend bundles (landing page + admin SPA)
deno task build

# Lint
deno lint

# Format
deno fmt
```

## Migrating from the Legacy Node.js Server

If you have an existing database from the original Node.js blossom-server, the
migration script imports all blob metadata atomically:

```sh
deno task migrate-from-legacy
```

The script reads the legacy SQLite database, imports all records into the Deno
server's schema, and performs an atomic file swap. Blob files on disk are left
untouched.

## License

MIT
