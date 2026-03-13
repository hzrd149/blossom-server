# Testing Guide

No tests exist yet. This doc maps every component to what should be tested, why
it matters, and how hard it is to write. Start with the high-priority items.

---

## Project structure recap

```
src/
  config/       schema.ts, loader.ts
  db/           blobs.ts, client.ts, bridge.ts, proxy.ts
  middleware/   auth.ts, cors.ts, errors.ts
  storage/      interface.ts, local.ts
  workers/      pool.ts, upload-worker.ts
  routes/       blobs.ts, upload.ts, delete.ts, list.ts
  server.ts
main.ts
```

---

## Unit tests

Fast, no real HTTP server, no real DB unless noted.

### 1. `src/middleware/auth.ts` — **highest priority**

`parseAuthEvent` (internal, but testable by calling the exported middleware with
crafted headers) covers the full BUD-11 spec. Every branch is a security rule.
Silent failures here mean unauthenticated writes.

Test cases:
- Valid event → middleware populates `ctx.var.auth`, `ctx.var.authType`
- `Authorization` header absent → `ctx.var.auth` is `undefined`, `next()` still called
- `Authorization: Nostr <not-base64>` → auth undefined, next() still called (parse-only)
- `kind !== 24242` → auth undefined
- `created_at` in the future → auth undefined
- `expiration` tag missing → auth undefined
- `expiration` tag in the past → auth undefined
- `t` tag missing → auth undefined
- `server` tag present, domain matches → auth set
- `server` tag present, domain does NOT match → auth undefined
- Bad signature → auth undefined
- `requireAuth(ctx, "upload")` with no auth → throws 401
- `requireAuth(ctx, "upload")` with auth of type "delete" → throws 403
- `requireAuth(ctx, "upload")` with correct type → returns the event
- `requireXTag(auth, hash)` when `x` tags are present but hash not listed → throws 403
- `requireXTag(auth, hash)` when `x` tags are present and hash is listed → no throw
- `requireXTag(auth, hash)` when NO `x` tags → no throw (open auth event)

How: Use `nostr-tools` to generate real signed events in tests. The
`generateSecretKey()` + `finalizeEvent()` + `verifyEvent()` pattern is exactly
what the middleware uses, so tests and production code share the same primitives.

```typescript
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { encodeBase64 } from "@std/encoding/base64";

function makeAuth(sk: Uint8Array, overrides?: Partial<...>) {
  const now = Math.floor(Date.now() / 1000);
  return finalizeEvent({
    kind: 24242,
    created_at: now,
    tags: [
      ["t", "upload"],
      ["expiration", String(now + 600)],
    ],
    content: "",
    ...overrides,
  }, sk);
}

function authHeader(event: NostrEvent) {
  return "Nostr " + encodeBase64(JSON.stringify(event));
}
```

### 2. `src/routes/blobs.ts` — `parseRange()` — **high priority**

`parseRange` is a pure function extracted from the route. Range bugs silently
corrupt partial downloads. Clients rely on this for video seeking.

Test cases (all pure, no I/O):
- `bytes=0-4` on a 11-byte blob → `{start:0, end:4}`
- `bytes=6-10` on a 11-byte blob → `{start:6, end:10}`
- `bytes=0-` (open end) → `{start:0, end:10}`
- `bytes=-5` (suffix) → `{start:6, end:10}`
- `bytes=5-3` (reversed) → `null`
- `bytes=0-99` on 11-byte blob (end past EOF) → `null`
- `bytes=-0` → `null`
- `bytes=abc-def` (non-numeric) → `null`
- `bytes=` (empty) → `null`
- Single-byte range: `bytes=5-5` → `{start:5, end:5}`

Problem: `parseRange` is not exported. It should be. Export it from `routes/blobs.ts`
or move it to `src/domain/range.ts` so tests can import it directly without spinning
up a full HTTP server.

### 3. `src/config/schema.ts` — **medium priority**

The Zod schema has non-obvious defaults and transform logic. A bad config that
silently applies wrong defaults is hard to debug in production.

Test cases:
- Empty object `{}` → all fields get their defaults
- Partial config (only `port` set) → other fields still get defaults
- `maxSize` as string `"100mb"` → parse error with useful message
- `port: 99999` → parse error
- `port: 0` → parse error
- `storage.backend: "gcs"` → parse error
- `upload.workers: -1` → parse error
- Valid full config round-trips correctly

### 4. `src/db/bridge.ts` + `src/db/proxy.ts` — **medium priority**

The MessageChannel round-trip is the least obvious piece of the architecture.
A broken `reqId` correlation or a missing op case is hard to debug under load.

The bridge and proxy can be tested together without a real Worker — just use
a `MessageChannel` directly in the test, install the bridge on port1, hand port2
to a `DbProxy`, and call proxy methods.

```typescript
const db = await createTestDb(); // in-memory LibSQL
const { port1, port2 } = new MessageChannel();
installDbBridge(db, port1);
const proxy = new DbProxy(port2);

await proxy.insertBlob({ sha256: "abc...", size: 10, type: null, uploaded: 0 }, "pubkey1");
assertEquals(await proxy.hasBlob("abc..."), true);
assertEquals(await proxy.hasBlob("nonexistent"), false);
assertEquals(await proxy.isOwner("abc...", "pubkey1"), true);
assertEquals(await proxy.isOwner("abc...", "other"), false);
```

Test cases:
- `hasBlob` returns `false` before insert, `true` after
- `getBlob` returns `null` before insert, correct record after
- `insertBlob` is idempotent (second call for same hash/pubkey doesn't throw)
- `isOwner` returns `false` for different pubkey
- Multiple concurrent in-flight calls resolve to the correct results (not swapped by reqId)
- DB error propagates as a rejected Promise (not a silent hang)

### 5. `src/storage/local.ts` — **medium priority**

The two-phase write (temp → rename) and the `has`/`read`/`remove` path.

Test cases (need real filesystem, use `Deno.makeTempDir`):
- `beginWrite` creates a file in `.tmp/`
- `commitWrite` renames it to the final hash path
- `commitWrite` on an already-existing hash removes the temp file (dedup)
- `abortWrite` removes the temp file
- `has` returns `false` for unknown hash, `true` after commit
- `read` returns `null` for unknown hash, a valid stream after commit
- `remove` returns `false` for unknown, `true` after commit, file is gone
- Concurrent `beginWrite` calls each get distinct temp paths (ULID uniqueness)

### 6. `src/db/blobs.ts` — **medium priority**

The SQL queries are hand-written. Wrong column index in a row mapping (e.g. `row[2]`
vs `row[3]`) silently returns garbage data.

Test cases (use in-memory LibSQL: `createClient({ url: ":memory:" })`):
- `insertBlob` + `getBlob` round-trip returns exact same fields
- `hasBlob` before/after insert
- `deleteBlob` removes blob and cascades to owners + accessed (FK cascade)
- `listBlobsByPubkey` returns only that pubkey's blobs
- `listBlobsByPubkey` respects `since` / `until` filters
- `listBlobsByPubkey` cursor pagination: second page doesn't repeat first page
- `isOwner` before/after insert
- Multiple pubkeys can own the same blob (re-upload)

---

## End-to-end tests

Real HTTP server, real SQLite DB, real filesystem, real worker pool.
Use Hono's test helper or `Deno.serve` on a random port with `fetch`.

### Setup helper

```typescript
async function startTestServer(overrides?: Partial<Config>) {
  const tmpDir = await Deno.makeTempDir();
  const db = await initDb(join(tmpDir, "test.db"));
  const storage = new LocalStorage(join(tmpDir, "blobs"));
  await storage.setup();
  const pool = initPool(1, db); // 1 worker is enough for sequential tests
  const config = ConfigSchema.parse({ ...defaults, ...overrides });
  const app = buildApp(db, storage, join(tmpDir, "blobs"), config);

  return { app, db, storage, pool, tmpDir,
    fetch: (path: string, init?: RequestInit) =>
      app.fetch(new Request(`http://localhost${path}`, init)),
    cleanup: async () => {
      pool.shutdown();
      db.close();
      await Deno.remove(tmpDir, { recursive: true });
    }
  };
}
```

### 7. Upload pipeline — **highest priority**

The most complex flow in the server. Several bugs were caught during manual
testing (wrong header name `x-sha256` vs `x-sha-256`). These would have been
caught immediately by an e2e test.

Test cases:
- `PUT /upload` no `Content-Length` → `411`
- `PUT /upload` `Content-Length` > maxSize → `413`, body never read
- `PUT /upload` disallowed MIME type → `415`
- `PUT /upload` no auth when required → `401`
- `PUT /upload` auth with wrong `t` tag → `403`
- `PUT /upload` with correct auth → `200`, valid BlobDescriptor JSON
- BlobDescriptor `sha256` matches SHA-256 of uploaded bytes
- BlobDescriptor `url` contains the `sha256`
- `PUT /upload` with matching `X-SHA-256` → `200`
- `PUT /upload` with mismatched `X-SHA-256` → `400` with "Hash mismatch" message
- `PUT /upload` same content twice → second returns `200` with same descriptor (dedup)
- `PUT /upload` same content, second uploader → both appear in owners table

### 8. BUD-06 preflight — **high priority**

`HEAD /upload` is used by clients to check server policy before sending a large
file. A broken preflight causes clients to upload and then get rejected.

Test cases:
- `HEAD /upload` no `X-Content-Length` header → `411`
- `HEAD /upload` `X-Content-Length` > maxSize → `413`
- `HEAD /upload` disallowed `X-Content-Type` → `415`
- `HEAD /upload` when pool is full → `503`
- `HEAD /upload` for existing blob (with `X-SHA-256`) → `200` with `X-Reason: Blob already exists`
- `HEAD /upload` for unknown blob → `200` (proceed to upload)

### 9. Blob retrieval — **high priority**

Test cases:
- `GET /:sha256` for nonexistent hash → `404`
- `GET /:sha256` after upload → `200`, body matches uploaded bytes
- `GET /:sha256.txt` (with extension) → `200`, same body
- `HEAD /:sha256` → `200`, no body, correct `Content-Length` header
- `GET /:sha256` with `Range: bytes=0-4` → `206`, correct partial body
- `GET /:sha256` with `Range: bytes=6-10` → `206`, correct partial body
- `GET /:sha256` with `Range: bytes=-5` (suffix) → `206`
- `GET /:sha256` with unsatisfiable range (past EOF) → `416`
- `Cache-Control: public, max-age=31536000, immutable` header present
- `Accept-Ranges: bytes` header present
- `OPTIONS /` → `204` with correct CORS headers

### 10. Delete — **high priority**

Test cases:
- `DELETE /:sha256` no auth when required → `401`
- `DELETE /:sha256` auth wrong `t` tag → `403`
- `DELETE /:sha256` auth for hash not in `x` tags (when x tags present) → `403`
- `DELETE /:sha256` non-owner pubkey → `403`
- `DELETE /:sha256` nonexistent hash → `404`
- `DELETE /:sha256` valid owner → `200`, subsequent `GET` → `404`
- File removed from filesystem after successful delete

### 11. List — **low priority** (disabled by default)

Test cases (only if `list.enabled: true`):
- `GET /list/:pubkey` → `200`, JSON array
- Returns only blobs owned by that pubkey
- Pagination: `?limit=1` returns 1 result, next page returns next
- `?since` / `?until` filters work

### 12. Worker pool saturation — **medium priority**

The no-queue / 503-on-full policy is a core security property.

Test cases:
- Spin up server with `workers: 1`
- Send 2 concurrent uploads (second should get `503`)
- After first upload completes, server accepts new uploads again

---

## What's NOT tested yet and why it matters

| Gap | Risk if untested |
|---|---|
| `parseRange` not exported | Range bugs go unnoticed until a video player breaks |
| Auth header name typos (`x-sha-256` vs `x-sha256`) | Was a real bug found only by manual testing |
| `insertBlob` row index mapping | Wrong field returned silently (e.g. size returns type) |
| Proxy `reqId` correlation under concurrency | Two concurrent DB calls could swap results |
| `commitWrite` dedup race condition | Two identical concurrent uploads could both try to rename |
| Config default application | Wrong defaults applied silently in production |

---

## Suggested file layout

```
tests/
  unit/
    auth.test.ts          middleware/auth.ts — parseAuthEvent, requireAuth, requireXTag
    range.test.ts         parseRange (export it first)
    config.test.ts        config/schema.ts — Zod parsing + defaults
    db-blobs.test.ts      db/blobs.ts — SQL queries against in-memory LibSQL
    db-bridge-proxy.test.ts  bridge + proxy round-trip via real MessageChannel
    storage-local.test.ts storage/local.ts — filesystem ops in temp dir
  e2e/
    upload.test.ts        PUT /upload, HEAD /upload, dedup, hash mismatch
    blobs.test.ts         GET/HEAD /:sha256, range requests, CORS headers
    delete.test.ts        DELETE /:sha256, ownership, 404
    auth.test.ts          Full auth flow: no auth, wrong type, expired, server tag
    pool.test.ts          Pool saturation → 503
```

## Running tests

```bash
deno test --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/
```

Add to `deno.json`:
```json
"test": "deno test --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-sys tests/"
```
