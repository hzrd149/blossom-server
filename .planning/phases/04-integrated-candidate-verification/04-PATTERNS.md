# Phase 4: Integrated Candidate Verification - Pattern Map

**Mapped:** 2026-10-05
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Tracked Analog | Match Quality |
|---|---|---|---|---|
| `src/utils/mime.ts` | utility | transform | `src/utils/mime.ts` | exact (extend existing classifier) |
| `src/routes/blobs.ts` | route | request-response / streaming | `src/routes/blobs.ts` | exact (extend existing conditional branch) |
| `tests/unit/mime.test.ts` | test | transform | `tests/unit/mime.test.ts` | exact |
| `tests/e2e/active-content.test.ts` | test | request-response / file-I/O / streaming | `tests/e2e/active-content.test.ts` | exact |
| `deno.json` | config | batch | `deno.json` and `scripts/nix-check.sh` | exact |
| `.planning/phases/04-integrated-candidate-verification/04-VERIFICATION-EVIDENCE.md` | verification evidence | batch | `.planning/phases/03-content-and-logging-boundaries/03-VERIFICATION.md` | role-match |

All named analogs were verified with `git ls-files`. Generated `.gsd` mirrors are not used. The classified scope deliberately contains no S3 test harness, emulator, credentials, or live-service configuration.

## Pattern Assignments

### `src/utils/mime.ts` (utility, transform)

**Analog:** `src/utils/mime.ts`

**Import and normalization pattern** (lines 1-6):

```typescript
import { extension as extFromMime } from "@std/media-types";

export function isEnvelopeMime(value: string | null | undefined): boolean {
  const baseMime = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return baseMime.startsWith("multipart/") || baseMime === "application/x-www-form-urlencoded";
}
```

**Core classifier pattern** (lines 9-18):

```typescript
export function isActiveContentMime(value: string | null | undefined): boolean {
  const baseMime = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (baseMime === "text/html" || baseMime === "text/xml" || baseMime === "application/xml") {
    return true;
  }

  const slash = baseMime.indexOf("/");
  return slash > 0 && baseMime.slice(slash + 1, -4).length > 0 && baseMime.endsWith("+xml");
}
```

Copy this normalization and exact-value style. Add only exact normalized `multipart/x-mixed-replace`; do not classify all `multipart/*` as active response content.

---

### `src/routes/blobs.ts` (route, request-response / streaming)

**Analog:** `src/routes/blobs.ts`

**Imports and exported pure-helper convention** (lines 13-27):

```typescript
import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { IBlobStorage } from "../storage/interface.ts";
import { isActiveContentMime, mimeToExt } from "../utils/mime.ts";

const BLOB_PATH_RE = /^([0-9a-f]{64})(?:\.[a-z0-9]{1,10})*$/i;

export function extractBlobHash(filename: string): string | null {
  return BLOB_PATH_RE.exec(filename)?.[1]?.toLowerCase() ?? null;
}
```

If the weak ETag matcher is extracted, follow the nearby exported pure-helper pattern so it can be tested without constructing an app.

**Stored-metadata response policy** (lines 70-85):

```typescript
const mimeType = blob.type ?? "application/octet-stream";
const headers: Record<string, string> = {
  "Content-Type": mimeType,
  "Content-Length": String(blob.size),
  "Accept-Ranges": "bytes",
  "Cache-Control": "public, max-age=31536000, immutable",
  ETag: `"${hash}"`,
  "Last-Modified": new Date(blob.uploaded * 1000).toUTCString(),
  "X-Content-Type-Options": "nosniff",
};

if (isActiveContentMime(blob.type)) {
  const safeExt = /^[a-z0-9]{1,10}$/i.test(ext) ? ext.toLowerCase() : "";
  const attachmentName = `${hash}${safeExt ? `.${safeExt}` : ""}`;
  headers["Content-Disposition"] = `attachment; filename="${attachmentName}"`;
}
```

**Conditional short-circuit and header projection** (lines 87-104):

```typescript
const ifNoneMatch = ctx.req.header("if-none-match");
if (ifNoneMatch) {
  // Replace the current strong-only normalization with RFC weak comparison.
  // Keep this branch before storage.read()/readRange().
  const notModifiedHeaders: Record<string, string> = {
    ETag: headers["ETag"],
    "Cache-Control": headers["Cache-Control"],
    "Last-Modified": headers["Last-Modified"],
    "X-Content-Type-Options": headers["X-Content-Type-Options"],
  };
  const disposition = headers["Content-Disposition"];
  if (disposition) notModifiedHeaders["Content-Disposition"] = disposition;
  return ctx.body(null, 304, notModifiedHeaders);
}
```

Preserve quoted ETag emission, wildcard behavior, comma-separated candidates, bodyless `304`, and the early short-circuit. Weak comparison strips only an optional valid `W/` prefix before comparing the quoted opaque tag.

---

### `tests/unit/mime.test.ts` (test, transform)

**Analog:** `tests/unit/mime.test.ts`

**Table-driven unit-test pattern** (lines 1-8, 33-37):

```typescript
import { assertEquals } from "@std/assert";
import { isActiveContentMime } from "../../src/utils/mime.ts";

const cases: ReadonlyArray<{
  name: string;
  value: string | null | undefined;
  expected: boolean;
}> = [/* cases */];

for (const testCase of cases) {
  Deno.test(`isActiveContentMime: ${testCase.name}`, () => {
    assertEquals(isActiveContentMime(testCase.value), testCase.expected);
  });
}
```

Add exact, mixed-case, and parameterized `multipart/x-mixed-replace` positives beside near-miss multipart controls. Keep tests pure and dependency-free.

---

### `tests/e2e/active-content.test.ts` (test, request-response / file-I/O / streaming)

**Analog:** `tests/e2e/active-content.test.ts`

**Real fixture imports and shape** (lines 1-16):

```typescript
import { assertEquals } from "@std/assert";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import { ConfigSchema } from "../../src/config/schema.ts";
import { initDb } from "../../src/db/client.ts";
import { insertBlobRecord } from "../../src/db/blobs.ts";
import { buildApp } from "../../src/server.ts";
import { LocalStorage } from "../../src/storage/local.ts";
```

**DB + local filesystem setup** (lines 23-29):

```typescript
Deno.test("blob responses isolate active content without changing ordinary retrieval", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "blossom_e2e_active_content_" });
  const db = await initDb({ path: join(tmpDir, "test.db") });
  const storage = new LocalStorage(join(tmpDir, "blobs"));
  await storage.setup();

  try {
```

**Production write and app seams** (lines 38-58):

```typescript
for (const fixture of fixtures) {
  const session = await storage.beginWrite(fixture.bytes.byteLength);
  const writer = session.writable.getWriter();
  await writer.write(fixture.bytes);
  await writer.close();
  await storage.commitWrite(session, fixture.hash, mimeToExt(fixture.type));
  await insertBlobRecord(db, {
    sha256: fixture.hash,
    size: fixture.bytes.byteLength,
    type: fixture.type,
    uploaded: 1_700_000_000,
    nip94: null,
  });
}
const app = await buildApp(db, storage, config);
```

**Response-matrix pattern** (lines 63-95):

```typescript
const activeGet = await app.fetch(new Request(`http://localhost${activePath}`));
assertEquals(activeGet.status, 200);
assertEquals(activeGet.headers.get("X-Content-Type-Options"), "nosniff");
assertEquals(activeGet.headers.get("Content-Disposition"), activeDisposition);

const activeHead = await app.fetch(new Request(`http://localhost${activePath}`, { method: "HEAD" }));
assertEquals(activeHead.status, 200);

const activeRange = await app.fetch(
  new Request(`http://localhost${activePath}`, { headers: { Range: "bytes=0-3" } }),
);
assertEquals(activeRange.status, 206);

const activeNotModified = await app.fetch(
  new Request(`http://localhost${activePath}`, { headers: { "If-None-Match": `"${active.hash}"` } }),
);
assertEquals(activeNotModified.status, 304);
assertEquals(activeNotModified.headers.has("Content-Length"), false);
```

Seed multipart bytes containing an HTML part and exercise GET, HEAD, range, strong `304`, and weak `304`. Include comma-list and non-match controls if the helper remains route-local. Continue using real LibSQL, `LocalStorage`, and `app.fetch()`; do not add an S3 fixture.

---

### `deno.json` (config, batch)

**Analog:** `deno.json`; implementation delegated to tracked scripts `scripts/nix-check.sh` (lines 5-21) and `scripts/nix-update-hashes.sh` (lines 70-74).

**Task alias pattern:**

```json
{
  "tasks": {
    "build": "deno task build:client && deno task build:css",
    "nix:check": "./scripts/nix-check.sh",
    "nix:update": "./scripts/nix-update-hashes.sh"
  }
}
```

Add compatibility aliases `check:nix` and `update:nix-hashes` that invoke the existing scripts (or existing task names) rather than duplicating shell logic. Preserve existing names for compatibility. If formatter exclusions are required for transient `.gsd` runtime state, scope them narrowly and do not hide tracked source/planning files.

---

### `.planning/phases/04-integrated-candidate-verification/04-VERIFICATION-EVIDENCE.md` (verification evidence, batch)

**Analog:** `.planning/phases/03-content-and-logging-boundaries/03-VERIFICATION.md`

**Metadata and outcome pattern** (lines 1-5, 46-51):

```markdown
---
phase: 04-integrated-candidate-verification
verified: <UTC timestamp>
status: <result>
---

# Phase 4: Integrated Candidate Verification Evidence

**Candidate SHA:** `<full SHA>`
**Status:** <result>
```

**Evidence-table pattern** (lines 57-62, 125-129):

```markdown
| Step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Focused contribution regression | Original failure/security condition remains closed | `<exact command and result>` | ✓ PASS |

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Complete server/client task | `deno task test` | `<pass counts>` | ✓ PASS |
```

Record one immutable candidate identity before the gates and confirm it afterward. Include contribution SHA-to-test mapping; both advisory dispositions; Deno version/format/lint/typecheck/test results; two clean generated-asset hashes; Docker command and image ID; Nix realization/rebuild/flake result and any conditional hash repair; local route/storage evidence; and final worktree status. State explicitly: **S3 contract/type/build compatibility verified; no live or emulated S3 execution performed.**

## Shared Patterns

### Real Application and Storage Boundary

**Source:** `tests/e2e/active-content.test.ts:23-58`
**Apply to:** all new route-level regressions

Use `Deno.makeTempDir()`, actual LibSQL metadata, actual `LocalStorage`, `buildApp()`, and `app.fetch()`. Cleanup belongs in the existing `finally` block. This is the behavioral storage gate for Phase 4.

### Conditional Response Ordering

**Source:** `src/routes/blobs.ts:54-139`
**Apply to:** ETag implementation and E2E assertions

Read authoritative metadata, confirm storage presence, construct shared headers, evaluate `If-None-Match`, then handle HEAD/range/full streaming. Do not move conditional evaluation after `read()` or `readRange()`.

### Contribution Traceability

**Source:** `.planning/phases/01-request-intake-boundaries/01-CONTRIBUTION-REVIEW.md:27-146`
**Apply to:** verification evidence ledger

Keep PR number, immutable integration SHA, deviation/disposition, exact focused command, result, and requirement boundary together. Map PRs #53, #54, #62, #63, and #64; treat the two advisory fixes as integrated PR #63/blob-response follow-up evidence, not new contributions.

### Deterministic Packaging Evidence

**Source:** `scripts/nix-check.sh:5-21`, `scripts/nix-update-hashes.sh:31-74`
**Apply to:** final build gates

Use the repository scripts for Nix realization and forced rebuild. Run hash update only after a genuine mismatch, inspect `nix/package.nix`, then rerun the full check. For ignored `public/client.js` and `public/styles.css`, remove only those known outputs, build twice, assert non-empty files, and compare SHA-256 values. Build Docker with `--pull --no-cache` and record the inspected image identity.

### Error and Security Preservation

**Source:** `src/routes/blobs.ts:54-139`
**Apply to:** route implementation and tests

Preserve status codes, stored `Content-Type`, `nosniff`, active-only attachment disposition, cache metadata, bodyless `304`, hash integrity, and streaming/range behavior. The Phase 4 change does not introduce new auth behavior or storage backends.

## No Analog Found

None. Every planned file has a tracked in-repository analog. No analog is sought for live/emulated S3 infrastructure because that work is explicitly deferred and must not be created in this phase.

## Metadata

**Analog search scope:** `src/utils`, `src/routes`, `tests/unit`, `tests/e2e`, `scripts`, `deno.json`, tracked prior phase evidence
**Files scanned for concrete extraction:** 9
**Pattern extraction date:** 2026-10-05
**Tracked-source gate:** passed for every named analog
