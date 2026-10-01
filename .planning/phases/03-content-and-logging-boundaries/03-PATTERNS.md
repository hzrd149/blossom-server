# Phase 3: Content and Logging Boundaries - Pattern Map

**Mapped:** 2026-10-01
**Files analyzed:** 7 new/modified files
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Tracked Analog | Match Quality |
|---|---|---|---|---|
| `src/utils/mime.ts` | utility | transform | existing `isEnvelopeMime()` in the same file | exact |
| `src/routes/blobs.ts` | route | request-response, streaming | existing full/HEAD/range/conditional branches in the same file | exact |
| `src/middleware/logger.ts` | middleware | request-response | `src/middleware/envelope.ts` URL-component parsing | role/data-flow match |
| `tests/unit/mime.test.ts` | test | transform | `tests/unit/envelope.test.ts` | exact |
| `tests/e2e/active-content.test.ts` | test | request-response, streaming, file-I/O | `tests/e2e/blobs.test.ts` plus the cleanup pattern in `tests/e2e/mirror-precheck.test.ts` | exact with fixture correction |
| `tests/unit/logger.test.ts` | test | request-response, event capture | console interception in `tests/unit/config.test.ts`; middleware mounting from `src/server.ts` | strong composite |
| `CHANGELOG.md` | documentation | release metadata | existing `Unreleased > Patch Changes` entries | exact |

All named analogs were checked with `git ls-files`; none are generated files or `.gsd` mirrors.

## Pattern Assignments

### `src/utils/mime.ts` (utility, transform)

**Analog:** `src/utils/mime.ts:3-7`

Use the same pure normalization shape as `isEnvelopeMime()`:

```ts
export function isEnvelopeMime(value: string | null | undefined): boolean {
  const baseMime = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return baseMime.startsWith("multipart/") || baseMime === "application/x-www-form-urlencoded";
}
```

Add `isActiveContentMime(value)` beside this predicate. Preserve the nullable input contract and normalize once with `split(";", 1)`, `trim()`, and `toLowerCase()`. Match exactly `text/html`, `text/xml`, and `application/xml`, plus a syntactically present subtype ending in `+xml`. Do not consult filenames or extensions.

For attachment extensions, retain the existing mapping authority at `src/utils/mime.ts:9-17`:

```ts
export function mimeToExt(mime: string | null): string {
  if (!mime || mime === "application/octet-stream") return "";
  return extFromMime(mime) ?? "";
}
```

The route should validate the returned extension before inserting it into a header filename. Do not replace `@std/media-types` with a hand-maintained mapping.

### `src/routes/blobs.ts` (route, request-response and streaming)

**Analog:** existing retrieval handler in `src/routes/blobs.ts:40-127`.

The current route already establishes the correct sequencing:

```ts
const blob = await getBlob(db, hash);
if (!blob) {
  return errorResponse(ctx, 404, "Blob not found");
}

const ext = mimeToExt(blob.type);

if (!(await storage.has(hash, ext))) {
  return errorResponse(ctx, 404, "Blob not found in storage");
}
```

Build policy only after stored metadata is found. `blob.type` is authoritative; `filename` is used only by `extractBlobHash()` at lines 41-42. Do not introduce any later security check against the cosmetic suffix.

Add `X-Content-Type-Options: nosniff` and the active-only `Content-Disposition` to the single shared header object at `src/routes/blobs.ts:70-78`. This object already flows unchanged to HEAD (`95-97`), full GET (`123-127`), and through object spreading to range `206` (`109-120`):

```ts
const headers: Record<string, string> = {
  "Content-Type": mimeType,
  "Content-Length": String(blob.size),
  "Accept-Ranges": "bytes",
  "Cache-Control": "public, max-age=31536000, immutable",
  ETag: `"${hash}"`,
  "Last-Modified": new Date(blob.uploaded * 1000).toUTCString(),
};
```

The important exception is the conditional response at `src/routes/blobs.ts:83-92`, which reconstructs a smaller header object:

```ts
return ctx.body(null, 304, {
  ETag: headers["ETag"],
  "Cache-Control": headers["Cache-Control"],
  "Last-Modified": headers["Last-Modified"],
});
```

Explicitly project `nosniff` and, when present, `Content-Disposition` into this `304` response. Preserve its no-body/no-`Content-Length` behavior. Do not spread the entire representation header object into `304`.

The attachment name must be the normalized full 64-character `hash`, optionally followed by a revalidated ASCII alphanumeric extension derived from `mimeToExt(blob.type)`. Fall back to the bare hash. The existing `BLOB_PATH_RE` at lines 23-27 is a useful character/length precedent, but the request suffix itself is not input to the filename.

Do not alter `readRange()` (`177-242`), the stream body, `416` behavior, or the `404` error path. This phase is response policy only.

### `src/middleware/logger.ts` (middleware, request-response)

**Analog:** URL parsing in `src/middleware/envelope.ts:8-23`, with paired logging preserved from `src/middleware/logger.ts:12-29`.

The project already obtains an encoded path component without manual slicing:

```ts
function envelopeMimeForRequest(request: Request): string | null {
  const pathname = new URL(request.url).pathname;
  // route checks use pathname
}
```

Replace only the logger's current `url.slice(url.indexOf("/", 8))` expression with `new URL(ctx.req.url).pathname`. Compute it once and reuse the same immutable value for both lines:

```ts
console.log(`--> ${method} ${path}`);
// await downstream
console.log(
  `<-- ${method} ${path} ${status} ${elapsedStr}${reason ? `  ${reason}` : ""}`,
);
```

Keep method, status, timing threshold, double-space reason separator, and `X-Reason` lookup unchanged. Do not call `decodeURI`, `decodeURIComponent`, Hono route-param decoding, or preserve query parameter names.

### `tests/unit/mime.test.ts` (test, transform)

**Analog:** table-driven predicate tests in `tests/unit/envelope.test.ts:1-41`.

```ts
const cases: ReadonlyArray<{
  name: string;
  value: string | null | undefined;
  expected: boolean;
}> = [
  // cases
];

for (const testCase of cases) {
  Deno.test(`isEnvelopeMime: ${testCase.name}`, () => {
    assertEquals(isEnvelopeMime?.(testCase.value), testCase.expected);
  });
}
```

Copy the typed truth-table shape. Cover absent/null/empty values; exact HTML/XML types; case and parameters; XHTML, SVG, XSLT; an arbitrary type such as `application/problem+xml`; and false controls such as JSON, plain text, images, and lookalikes (`application/xml-extra`, `application/+xml-extra`). If tests are committed before the export exists, the existing dynamic-import/optional-call style provides a compilable red test; after implementation, prefer a direct named import so a missing export is a type-check failure.

### `tests/e2e/active-content.test.ts` (test, request-response, streaming and file-I/O)

**Primary route analog:** `tests/e2e/blobs.test.ts:318-340,375-429` demonstrates `app.fetch()` assertions for stored metadata, cosmetic suffixes, GET, HEAD, and ranges.

```ts
const getResponse = await app.fetch(new Request(`http://localhost${pathname}`));
assertEquals(getResponse.status, 200, pathname);
assertEquals(getResponse.headers.get("Content-Type"), "application/octet-stream", pathname);

const headResponse = await app.fetch(new Request(`http://localhost${pathname}`, { method: "HEAD" }));
assertEquals(headResponse.status, 200, pathname);
```

```ts
const res = await app.fetch(
  new Request(`http://localhost${blobUrl}`, {
    headers: { Range: "bytes=0-3" },
  }),
);
assertEquals(res.status, 206);
assertEquals(res.headers.get("Content-Range"), `bytes 0-3/${BLOB_SIZE}`);
```

Use this status/header/body style to exercise the complete matrix for active and ordinary stored MIME values: full GET `200`, HEAD `200`, range `206`, and matching `If-None-Match` `304`. Assert active disposition and full hash-derived name on all four; assert `nosniff` but no disposition for ordinary media. Test an active blob requested with `.png` and an ordinary blob requested with `.html` to prove suffix irrelevance. Include an unknown/safely unmappable active MIME case if the fixture can persist one, proving the bare-hash fallback.

**Fixture lifecycle analog:** use the self-contained `try/finally` form in `tests/e2e/mirror-precheck.test.ts:40-113`, not the shared setup/teardown sequence in `tests/e2e/blobs.test.ts`:

```ts
const tmpDir = await Deno.makeTempDir({ prefix: "..." });
const dbPath = join(tmpDir, "test.db");
const db = await initDb({ path: dbPath });
const storage = new LocalStorage(join(tmpDir, "blobs"));
await storage.setup();
const pool = initPool(1, 4, 500, db, { path: dbPath });

try {
  // assertions
} finally {
  pool.shutdown();
  db.close();
  await Deno.remove(tmpDir, { recursive: true });
}
```

This avoids filter-dependent tests, a known warning from Phase 2. Prefer direct fixture seeding through tracked DB/storage interfaces when practical, or upload within the same test; either way metadata and bytes must agree (`mimeToExt(type)` determines the on-disk extension). Cancel unused response bodies. Retain `{ sanitizeOps: false, sanitizeResources: false }` if the worker pool is initialized.

### `tests/unit/logger.test.ts` (test, request-response and event capture)

**Console interception analog:** `tests/unit/config.test.ts:28-67`.

```ts
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));

try {
  // invoke behavior and assert captured output
} finally {
  console.warn = originalWarn;
}
```

Apply this pattern to `console.log`, always restoring it in `finally`. Mount `requestLogger` on a minimal Hono app, matching global middleware registration in `src/server.ts:41-45`, then add a deterministic response handler that returns a status and `X-Reason`. Request a URL with a percent-encoded pathname and unique query names/values.

Assert exactly two captured lines. The request line should exactly equal the method plus serialized pathname. Match the response line with a regular expression tolerant of `0ms`/other elapsed values while requiring the same pathname, expected status, and reason. Assert neither query names nor values occur in either line. Avoid a full `buildApp()` fixture: logger behavior is isolated middleware and needs no DB, storage, or worker pool.

Because `console.log` is process-global, keep all interception and assertions inside one `Deno.test` and do not opt that test into parallel execution.

### `CHANGELOG.md` (documentation, release metadata)

**Analog:** `CHANGELOG.md:3-12`.

Add Phase 3 user-facing behavior under the existing `Unreleased` / `Patch Changes` heading. Preserve explicit upstream attribution and PR links, as current Phase 1/2 entries do:

```md
- ...; contributed by [@mptfire](https://github.com/mptfire) in [#NN](https://github.com/hzrd149/blossom-server/pull/NN).
```

Use separate entries for PR #63 active-content isolation and PR #64 query-free logging so traceability remains unambiguous. Do not create a version heading.

## Shared Patterns

### Stored metadata controls blob behavior

**Sources:** `src/routes/blobs.ts:41-72`, `tests/e2e/blobs.test.ts:318-340`

The requested suffix is accepted cosmetically and discarded after hash extraction. MIME classification, storage extension, response `Content-Type`, and attachment filename extension all derive from `blob.type`.

### Build headers once, audit short-circuits separately

**Source:** `src/routes/blobs.ts:70-127`

The shared `headers` object covers GET, HEAD, and `206`; `304` is a deliberate projection and must be updated explicitly. Error responses (`404`, `416`) are outside the successful-representation guarantee.

### Platform URL parsing preserves the component boundary

**Sources:** `src/middleware/envelope.ts:8-23`, `src/server.ts:56-59`

Use `new URL(request.url).pathname` for encoded pathname serialization. Do not manually search for `?` or assume a fixed authority offset.

### Tests restore global state and own their resources

**Sources:** `tests/unit/config.test.ts:28-67`, `tests/e2e/mirror-precheck.test.ts:40-113`

Global replacements belong in `try/finally`; temp directories, worker pools, DB clients, and servers should be created and cleaned inside the same test. This makes focused `--filter` runs valid.

## Pitfalls for the Planner and Executor

- A finite list copied from PR #63 does not satisfy the locked arbitrary `+xml` rule.
- `nosniff` alone is not the download boundary; active content also needs `Content-Disposition: attachment`.
- Spreading all normal response headers into `304` risks adding representation-only fields such as `Content-Length`; project only the required security and cache metadata.
- `mimeToExt()` accepts nullable MIME but may not normalize parameterized/case-varied input the same way as the classifier. Tests should make the filename expectation explicit; route code should validate any returned extension and safely fall back.
- Never derive the attachment extension from `ctx.req.param("filename")`.
- The existing `tests/e2e/blobs.test.ts` shared setup is useful as an assertion analog but is deliberately not the lifecycle analog for a new test file.
- A logger test that does not restore `console.log` in `finally` can corrupt the remaining suite after a failure.
- Do not include captured `robots.txt` work, Phase 2 test-harness cleanup, storage consistency refactors, or changes to streaming/range parsing.

## No Analog Found

None. Every planned file has a tracked repository analog. `tests/unit/logger.test.ts` uses a composite analog because no existing test directly mounts `requestLogger`, but both middleware registration and safe console interception are established patterns.

## Metadata

**Analog search scope:** `src/routes/`, `src/middleware/`, `src/utils/`, `src/db/`, `src/storage/`, `tests/unit/`, `tests/e2e/`, and `CHANGELOG.md`

**Primary files read:** 14

**Pattern extraction date:** 2026-10-01
