# Blossom Server — Architecture

Deno 2.7 rewrite of the blossom blob server. The legacy Node.js implementation
lives in `legacy-nodejs/` and is kept as a reference.

## Goals

- Maximum concurrent uploads and downloads
- Full BUD-01, BUD-02, BUD-06, BUD-11 compliance out of the box
- BUD-04 (mirror), BUD-05 (media), BUD-08 (nip94), BUD-09 (report) as optional
  extensions
- Zero-copy streaming on both upload and download paths
- Bounded, predictable memory under adversarial load

---

## Stack

| Layer          | Choice                                              | Rationale                                                                     |
| -------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Runtime        | Deno 2.7                                            | Native `ReadableStream`, HTTP/2, async I/O, no install step                   |
| HTTP Framework | Hono (`jsr:@hono/hono`)                             | Web-standard streaming, radix trie router, ~0% overhead vs raw `Deno.serve()` |
| Metadata DB    | LibSQL embedded (`npm:@libsql/client`, `file:` URL) | Async I/O — `@db/sqlite` WASM is synchronous and blocks the event loop        |
| Storage        | Two-phase streaming adapters (local + S3)           | Zero-copy: stream flows network→disk or disk→network without buffering        |
| Config         | YAML + env var overlay                              | Matches legacy UX; Deno has built-in YAML parsing via `@std/yaml`             |
| Hashing        | `@std/crypto` streaming digest                      | True chunk-by-chunk SHA-256, no full-body buffering                           |

---

## Project Structure

```
src/
  server.ts           — Hono app assembly + Deno.serve() entry point
  config/
    schema.ts         — Zod-validated config type
    loader.ts         — YAML file load + env var overlay
  middleware/
    cors.ts           — BUD-01 CORS + OPTIONS preflight headers
    auth.ts           — BUD-11 parse, verify, requireAuth/optionalAuth helpers
    errors.ts         — X-Reason error response formatter
  routes/
    blobs.ts          — GET/HEAD /:sha256[.ext] (BUD-01)
    upload.ts         — PUT /upload, HEAD /upload (BUD-02, BUD-06)
    list.ts           — GET /list/:pubkey (BUD-02)
    delete.ts         — DELETE /:sha256 (BUD-02)
  domain/
    upload.ts         — upload pipeline: policy check, tee, hash+write, dedup
    retrieve.ts       — blob lookup, range header support
    prune.ts          — expiry rules engine
  storage/
    interface.ts      — IBlobStorage interface (two-phase beginWrite/commitWrite)
    local.ts          — Deno.open() + atomic Deno.rename() adapter
    s3.ts             — fetch()-based multipart S3 adapter
  db/
    client.ts         — LibSQL client init (file: URL for embedded)
    migrations/
      001_initial.sql — CREATE TABLE statements
    blobs.ts          — blob CRUD queries
    owners.ts         — uploader_pubkey ownership queries
    accessed.ts       — LRU access timestamps for prune rules
  workers/
    hash-worker.ts    — Deno Worker: receives transferred ReadableStream, streams SHA-256
    pool.ts           — WorkerPool: pre-warmed workers, acquire/release, no queue
main.ts               — thin entry point
deno.json             — tasks, import map
config.example.yml    — annotated config reference
```

---

## Upload Concurrency Design

### The Problem

SHA-256 computation is CPU-bound. Running it on the main event loop blocks all
other requests for the duration of the hash. Under concurrent uploads this
serializes work.

### The Solution: Worker Pool + Stream Tee

```
PUT /upload
  │
  ├─ MIDDLEWARE (before body arrives):
  │   1. BUD-11 auth check (parse Authorization header)
  │   2. Content-Length required → 411 if absent
  │   3. Content-Length > maxSize → 413 (body never read)
  │   4. Worker pool has free worker? → 503 if pool full (body never read)
  │
  ├─ Acquire worker from pool
  │
  ├─ req.body.tee()
  │    │                    │
  │  [hashBranch]      [diskBranch]
  │  transferred to    piped directly to
  │  hash worker       storage.beginWrite()
  │    │               (Deno async I/O,
  │    │                temp file, zero-copy)
  │    │                    │
  │    └──── await Promise.all([hash, write]) ────┘
  │
  ├─ verify computed hash === X-SHA-256 header (if provided)
  ├─ storage.commitWrite(session, hash)  ← atomic Deno.rename()
  ├─ db.insertBlob(hash, size, mime, uploader_pubkey)
  ├─ release worker back to pool
  └─ return BlobDescriptor JSON
```

**Key properties:**

- Hash worker uses `@std/crypto.subtle.digest(stream)` — true streaming, zero
  buffering
- Disk branch is pure async I/O — zero buffering, zero CPU on main thread
- Both branches drain concurrently (tee distributes chunks to both readers)
- Memory ceiling: `poolSize × maxUploadSize` (e.g. 8 cores × 100MB = 800MB max)

### No Queue

There is no request queue. When the pool is full, the server returns 503
immediately with `Retry-After` before reading any body bytes. This is the
critical security property:

- A queued request holds its OS TCP receive buffer (~1–4MB) open indefinitely
- With a queue of depth N, an attacker fills N slots with slow/large bodies
- Without a queue, rejected connections get 503 + `Connection: close` in ~6ms
  and their OS buffers are freed immediately

### Chunked Upload Policy

`Content-Length` is required for all uploads. Requests without it receive
`411 Length
Required`. This eliminates the chunked transfer encoding attack
vector where an attacker sends no declared size and drip-feeds bytes to stay
under backpressure thresholds.

Blob upload clients always know the file size before uploading. This is not a
compatibility concern in practice.

### Pool Size

Defaults to `navigator.hardwareConcurrency` (one worker per CPU core). Override
via `upload.hashWorkers` in config. Each worker is a persistent pre-warmed Deno
Worker (separate V8 isolate) that handles one upload at a time, reused across
requests.

---

## Download Design

Downloads are entirely on the main thread. There is no CPU-bound work:

```
GET /:sha256
  → DB lookup (async LibSQL, ~0.1ms)
  → storage.read(hash) → ReadableStream<Uint8Array>
      local:  Deno.open(path) → file.readable
      S3:     fetch(s3url) → response.body
  → Range header? slice the stream
  → new Response(stream, { headers })
  → Hono passes stream to Deno.serve() unchanged
  → Deno.serve() pipes to TCP socket via OS async I/O
```

Zero intermediate copies. The kernel handles read-from-disk → write-to-socket.
Deno's event loop handles N concurrent downloads simultaneously via async I/O
multiplexing.

---

## Storage Interface

```typescript
interface IBlobStorage {
  has(hash: string): Promise<boolean>;
  read(hash: string): Promise<ReadableStream<Uint8Array> | null>;
  size(hash: string): Promise<number | null>;
  type(hash: string): Promise<string | null>;

  // Two-phase write: stream to temp → verify → atomic commit
  beginWrite(sizeHint: number | null): Promise<WriteSession>;
  commitWrite(session: WriteSession, hash: string): Promise<void>;
  abortWrite(session: WriteSession): Promise<void>;

  remove(hash: string): Promise<boolean>;
}

interface WriteSession {
  writable: WritableStream<Uint8Array>;
  // resolved when writable is closed
  done: Promise<void>;
}
```

**Local adapter:** streams to `<storageDir>/.tmp/<uuid>`, on `commitWrite` calls
`Deno.rename(tmpPath, <storageDir>/<hash>)`. Rename is atomic on POSIX because
temp file and final destination are on the same filesystem.

**S3 adapter:** `beginWrite` starts a multipart upload; `commitWrite` calls
`CompleteMultipartUpload`. `sizeHint` is passed as the part size hint.

---

## Auth (BUD-11)

The global Hono middleware parses the `Authorization: Nostr <base64url>` header
and populates `ctx.var.auth` if present. It never throws — parsing failure just
leaves `ctx.var.auth` undefined.

Route handlers call `requireAuth(ctx, 'upload')` or `optionalAuth(ctx)`
explicitly. There is no implicit auth — every route must make a deliberate
choice.

Validation per BUD-11 spec:

1. `kind` must be `24242`
2. `created_at` must be in the past
3. `expiration` tag must be present and in the future
4. `t` tag must match the required action verb
5. If `server` tags present, this server's domain must appear in at least one
6. If endpoint requires `x` tags, at least one must match the blob hash
7. Signature verified via `nostr-tools/pure` `verifyEvent()`

---

## Database Schema

```sql
-- blobs: core metadata
CREATE TABLE blobs (
  sha256    TEXT(64) PRIMARY KEY,
  size      INTEGER  NOT NULL,
  type      TEXT,
  uploaded  INTEGER  NOT NULL
);

-- owners: which pubkey uploaded which blob (many-to-one blob)
CREATE TABLE owners (
  blob      TEXT(64) NOT NULL REFERENCES blobs(sha256) ON DELETE CASCADE,
  pubkey    TEXT(64) NOT NULL,
  PRIMARY KEY (blob, pubkey)
);

-- accessed: last-access timestamp for LRU prune rules
CREATE TABLE accessed (
  blob      TEXT(64) PRIMARY KEY REFERENCES blobs(sha256) ON DELETE CASCADE,
  timestamp INTEGER  NOT NULL
);
```

---

## Config Shape

```yaml
# Override the domain used in blob URLs (defaults to request Host header)
publicDomain: ""

databasePath: data/sqlite.db

storage:
  backend: local # local | s3
  local:
    dir: ./data/blobs
  # s3:
  #   endpoint: https://s3.example.com
  #   bucket: blossom
  #   accessKey: "${S3_ACCESS_KEY}"
  #   secretKey: "${S3_SECRET_KEY}"
  #   region: us-east-1
  #   publicURL: ""       # if set, GET redirects here instead of proxying

  rules:
    - type: "image/*"
      expiration: 1 month
    - type: "*"
      expiration: 1 week

upload:
  enabled: true
  requireAuth: true
  maxSize: 104857600 # 100MB
  hashWorkers: 0 # 0 = navigator.hardwareConcurrency

list:
  enabled: false # BUD-02 list is unrecommended; off by default
  requireAuth: false
  allowListOthers: true

delete:
  requireAuth: true
```

---

## Security Properties

| Property                         | Mechanism                                                        |
| -------------------------------- | ---------------------------------------------------------------- |
| No body buffering on rejection   | 411/413/503 returned before `req.body` is touched                |
| No unbounded memory from uploads | No queue; pool full = 503; ceiling = poolSize × maxSize          |
| Atomic blob writes               | `Deno.rename()` from same-filesystem temp file                   |
| Auth default-deny                | Every route calls `requireAuth()` or `optionalAuth()` explicitly |
| Delete ownership check           | DB query verifies `uploader_pubkey` matches auth pubkey          |
| Chunked upload blocked           | `Content-Length` required; 411 if absent                         |
| BUD-11 server tag scoping        | Validated when `server` tags present in auth event               |

---

## BUD Coverage

| BUD    | Status   | Notes                                                      |
| ------ | -------- | ---------------------------------------------------------- |
| BUD-01 | Core     | GET/HEAD /:sha256[.ext], CORS, range requests              |
| BUD-02 | Core     | PUT /upload, DELETE /:sha256, GET /list/:pubkey (optional) |
| BUD-04 | Optional | PUT /mirror — server-side fetch + pipe                     |
| BUD-05 | Optional | PUT /media — Worker-isolated transcode (requires ffmpeg)   |
| BUD-06 | Core     | HEAD /upload preflight                                     |
| BUD-07 | Future   | 402 Payment Required stubs                                 |
| BUD-08 | Core     | `nip94` field in BlobDescriptor                            |
| BUD-09 | Optional | PUT /report                                                |
| BUD-11 | Core     | All auth                                                   |
