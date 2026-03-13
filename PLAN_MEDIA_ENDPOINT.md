# Plan: `PUT /media` Endpoint (BUD-05)

> Status: **PLANNED — not yet implemented**
> Written: 2026-03-13

This document captures the full design for porting the legacy Node.js `/media`
endpoint to the Deno rewrite. Read `legacy-nodejs/src/api/media.ts` and
`legacy-nodejs/src/optimize/` as the reference implementation.

---

## What `/media` Does

`PUT /media` is an upload endpoint that **transforms media before storing it**.
The client uploads an image or video; the server optimizes/transcodes it, stores
the *optimized* output, and returns the hash and URL of the optimized file — not
the original.

`HEAD /media` is the BUD-06-style preflight: auth + availability check, 200 OK
body-less response.

### Processing capabilities

| Input MIME      | Library         | Output (default)  |
|-----------------|-----------------|-------------------|
| `image/jpeg`    | `npm:sharp`     | WebP              |
| `image/png`     | `npm:sharp`     | WebP              |
| `image/webp`    | `npm:sharp`     | WebP              |
| `image/gif`     | `npm:sharp`     | animated WebP     |
| `video/*`       | `fluent-ffmpeg` | MP4 (H.264 + AAC) |

---

## Key Differences from `PUT /upload`

| Dimension         | `/upload`                       | `/media`                                 |
|-------------------|---------------------------------|------------------------------------------|
| Auth verb         | `"upload"`                      | `"media"`                                |
| Processing        | None — original stored as-is    | Optimize/transcode before storage        |
| Stored blob       | Original bytes                  | **Optimized derivative**                 |
| Returned hash     | Hash of uploaded bytes          | Hash of **transformed** bytes            |
| x-tag check       | Pre-body header + worker verify | **Post-body**, against original hash     |
| Dedup short-circuit | Original hash lookup          | Original → optimized mapping lookup      |

---

## Architecture Decisions

| Decision                    | Choice                          | Rationale                                                              |
|-----------------------------|---------------------------------|------------------------------------------------------------------------|
| Image library               | `npm:sharp` (already in deno.json) | Already imported; proven; handles JPEG/PNG/WebP/animated GIF       |
| Video library               | `npm:fluent-ffmpeg`             | Same as legacy; handles codec flags, progress, format mapping          |
| ffmpeg binary               | System `ffmpeg` (host-provided) | `fluent-ffmpeg` wraps it — must be installed on host / in Docker image |
| Temp file generation        | `join(storageDir, ".tmp", ulid())` | Same filesystem as storage dir → atomic `Deno.rename()` guaranteed  |
| Re-hash after optimization  | `stdCrypto.subtle.digest("SHA-256", asyncChunks)` | Consistent with codebase; no full-file allocation |
| MIME allowlist              | `config.upload.allowedTypes`    | Reuse existing per-operator allowlist                                  |
| Dedup strategy              | Short-circuit via `media_derivatives` table | Skip optimization CPU cost for repeat original uploads     |
| Original blob stored?       | **No** — discarded after x-tag verify | Client signed the original; only the optimized hash is returned    |

---

## Files to Create / Modify

| File                                       | Change    | Notes                                        |
|--------------------------------------------|-----------|----------------------------------------------|
| `src/db/migrations/002_media_derivatives.sql` | **New** | `media_derivatives` table                    |
| `src/db/client.ts`                         | **Edit**  | Run all `migrations/*.sql` files in order    |
| `src/db/blobs.ts`                          | **Edit**  | Add `getMediaDerivative()` + `insertMediaDerivative()` |
| `src/config/schema.ts`                     | **Edit**  | Add `ImageOptimizeSchema`, `VideoOptimizeSchema`, `MediaSchema` |
| `src/optimize/index.ts`                    | **New**   | `optimizeMedia()` dispatcher                 |
| `src/optimize/image.ts`                    | **New**   | `optimizeImage()` + `optimizeGif()`          |
| `src/optimize/video.ts`                    | **New**   | `optimizeVideo()`                            |
| `src/routes/media.ts`                      | **New**   | `buildMediaRouter()` — PUT + HEAD handlers   |
| `src/server.ts`                            | **Edit**  | Register `buildMediaRouter()`                |
| `deno.json`                                | **Edit**  | Add `fluent-ffmpeg` + `@types/fluent-ffmpeg` |

---

## DB Migration: `002_media_derivatives.sql`

```sql
-- Maps original (pre-optimization) SHA-256 → optimized (post-optimization) SHA-256.
-- Allows PUT /media to short-circuit optimization when the same original was
-- already processed. On DELETE CASCADE from blobs ensures cleanup if the
-- optimized blob is ever pruned.
CREATE TABLE IF NOT EXISTS media_derivatives (
  original_sha256   TEXT(64) NOT NULL,
  optimized_sha256  TEXT(64) NOT NULL REFERENCES blobs(sha256) ON DELETE CASCADE,
  PRIMARY KEY (original_sha256)
);
```

### Migration runner update (`src/db/client.ts`)

The current runner hardcodes `001_initial.sql`. Change it to iterate all
`migrations/*.sql` files in alphabetical (numeric) order using `Deno.readDir()`.
All statements still use `CREATE TABLE IF NOT EXISTS` — safe to re-run at startup.

---

## Config Schema Additions (`src/config/schema.ts`)

```ts
const ImageOptimizeSchema = z.object({
  quality:             z.number().int().min(0).max(100).default(90),
  maxWidth:            z.number().int().positive().default(1920),
  maxHeight:           z.number().int().positive().default(1080),
  outputFormat:        z.enum(["webp", "jpeg", "png"]).default("webp"),
  maintainAspectRatio: z.boolean().default(true),
  keepExif:            z.boolean().default(false),
});

const VideoOptimizeSchema = z.object({
  quality:   z.number().int().min(0).max(100).default(90),
  maxHeight: z.number().int().positive().default(1080),
  maxFps:    z.number().int().positive().default(30),
  format:    z.enum(["mp4", "webm", "mkv"]).default("mp4"),
});

const MediaSchema = z.object({
  enabled:     z.boolean().default(false),
  requireAuth: z.boolean().default(true),
  maxSize:     z.number().int().positive().default(500 * 1024 * 1024), // 500MB
  image:       ImageOptimizeSchema.optional().transform(v => v ?? ImageOptimizeSchema.parse({})),
  video:       VideoOptimizeSchema.optional().transform(v => v ?? VideoOptimizeSchema.parse({})),
});
```

Add to `ConfigSchema`:
```ts
media: MediaSchema.optional().transform(v => v ?? MediaSchema.parse({})),
```

Export types:
```ts
export type ImageOptimizeConfig = z.infer<typeof ImageOptimizeSchema>;
export type VideoOptimizeConfig = z.infer<typeof VideoOptimizeSchema>;
export type MediaConfig = z.infer<typeof MediaSchema>;
```

---

## DB Query Functions (`src/db/blobs.ts`)

```ts
/** Returns the optimized blob SHA-256 for a given original SHA-256, or null. */
export async function getMediaDerivative(
  db: Client,
  originalSha256: string,
): Promise<string | null>

/** Records an original → optimized SHA-256 mapping. */
export async function insertMediaDerivative(
  db: Client,
  originalSha256: string,
  optimizedSha256: string,
): Promise<void>
```

---

## Optimize Module (`src/optimize/`)

### `src/optimize/image.ts`

```ts
import sharp from "sharp";

export interface ImageOptimizeOptions { /* mirrors ImageOptimizeConfig */ }

/**
 * Optimizes a static image (JPEG/PNG/WebP) using sharp.
 * Returns the path to the optimized temp file.
 * Caller is responsible for deleting the output file on error.
 */
export async function optimizeImage(
  inputPath: string,
  opts: ImageOptimizeOptions,
): Promise<string>

/**
 * Optimizes an animated GIF.
 * - outputFormat === "webp": uses sharp animated WebP path (preferred).
 * - other formats: falls back to fluent-ffmpeg.
 * Returns the path to the optimized temp file.
 */
export async function optimizeGif(
  inputPath: string,
  opts: ImageOptimizeOptions,
): Promise<string>
```

**sharp pipeline:**
1. `sharp(inputPath[, { animated: true }])` for GIF
2. `withMetadata({ exif: {} })` if `keepExif` is false, else `withMetadata()`
3. `resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true })`
4. Encode to `outputFormat` with `quality`
5. Write to `await Deno.makeTempFile({ suffix: ".webp" })`

### `src/optimize/video.ts`

```ts
import ffmpeg from "fluent-ffmpeg";

export interface VideoOptimizeOptions { /* mirrors VideoOptimizeConfig */ }

/**
 * Transcodes a video file using ffmpeg.
 * Returns the path to the transcoded temp file.
 */
export async function optimizeVideo(
  inputPath: string,
  opts: VideoOptimizeOptions,
): Promise<string>
```

**Format → codec mapping:**

| format | videoCodec | audioCodec | extra flags          |
|--------|------------|------------|----------------------|
| `mp4`  | `libx264`  | `aac`      | `-movflags +faststart` |
| `webm` | `vp9`      | `opus`     | —                    |
| `mkv`  | `libx264`  | `aac`      | —                    |

**Quality → CRF:** `CRF = Math.round(51 - (quality / 100) * 51)`
(quality=90 → CRF≈5, quality=0 → CRF=51)

**ffprobe:** Probe original FPS from `r_frame_rate`; clamp to `min(originalFps, maxFps)`.

**Size filter:** `?x<maxHeight>` — lets ffmpeg maintain aspect ratio automatically.

### `src/optimize/index.ts`

```ts
import { getType } from "@std/media-types";  // extension-based
// npm:file-type for magic-byte fallback (add to deno.json)

export async function optimizeMedia(
  inputPath: string,
  config: MediaConfig,
): Promise<string>
```

**MIME detection order:**
1. `getType(inputPath)` — extension-based via `@std/media-types`
2. Magic-byte fallback: read first 4096 bytes → `fileTypeFromBuffer()` from `npm:file-type`
3. If still unknown: throw `Error("Unsupported file type")`

**Dispatch table:**
- `image/jpeg` | `image/png` | `image/webp` → `optimizeImage()`
- `image/gif` → `optimizeGif()`
- `video/*` → `optimizeVideo()`
- anything else → throw `Error("Unsupported file type")`

**Error handling:** wrap entire body in try/catch; on failure delete any partial
output temp file before rethrowing with `"Optimization failed: <message>"` prefix.

---

## Route: `src/routes/media.ts`

```ts
export function buildMediaRouter(
  db: Client,
  storageDir: string,
  config: Config,
): Hono
```

### `HEAD /media` pipeline

```
1. config.media.enabled → 403 "Media endpoint is disabled on this server"
2. config.media.requireAuth → requireAuth(ctx, "media") → 401/403
3. getPool().available === 0 → 503 "Server busy..."
4. return ctx.body(null, 200)
```

### `PUT /media` pipeline

```
 1.  config.media.enabled → 403
 2.  config.media.requireAuth → requireAuth(ctx, "media") → 401/403
     (captures auth — used for x-tag check and owner registration)
 3.  Content-Length required → 411 (cancel body)
 4.  parseInt(Content-Length) > config.media.maxSize → 413 (cancel body)
 5.  content-type header → mimeType = contentType.split(";")[0].trim()
     config.upload.allowedTypes check → 415 (cancel body)
 6.  X-SHA-256 header format check (/^[0-9a-f]{64}$/) → 400 (cancel body)
 7.  getPool().available === 0 → 503 (cancel body)
 8.  tmpPath = join(storageDir, ".tmp", ulid())
 9.  jobPromise = pool.dispatch(body, tmpPath, contentLength, null)
     null (race) → 503
10.  { hash: originalHash, size: originalSize } = await jobPromise
     failure → 400 err.message
11.  BUD-11 x-tag verification (STRICT — x tags required for /media):
       auth present + no x tags in event → Deno.remove(tmpPath) → 403
       auth present + x tags present + none matches originalHash → Deno.remove(tmpPath) → 403
12.  SHORT-CIRCUIT dedup:
       derivative = await getMediaDerivative(db, originalHash)
       if derivative found:
         await Deno.remove(tmpPath)
         existing = await getBlob(db, derivative)
         if auth && !await isOwner(db, derivative, auth.pubkey):
           await insertBlob(db, existing, auth.pubkey)
         return BlobDescriptor JSON for existing optimized blob
13.  optimizedTmpPath = await optimizeMedia(tmpPath, config.media)
     failure → await Deno.remove(tmpPath) → 500 err.message
14.  await Deno.remove(tmpPath)    ← original temp no longer needed
15.  Re-hash optimizedTmpPath:
       open file → read as async chunks → stdCrypto.subtle.digest("SHA-256", chunks)
       → optimizedHash (hex string)
       → optimizedSize (sum of chunk.byteLength)
16.  Detect MIME of optimized output:
       getType(optimizedTmpPath) from @std/media-types
       → optimizedMime (e.g. "image/webp", "video/mp4")
17.  DEDUP: if await hasBlob(db, optimizedHash):
       await Deno.remove(optimizedTmpPath)
       existing = await getBlob(db, optimizedHash)
       await insertMediaDerivative(db, originalHash, optimizedHash)  ← record mapping
       if auth && !await isOwner(db, optimizedHash, auth.pubkey):
         await insertBlob(db, existing, auth.pubkey)
       return BlobDescriptor JSON
18.  ext = mimeToExt(optimizedMime)
     finalName = ext ? `${optimizedHash}.${ext}` : optimizedHash
     finalPath = join(storageDir, finalName)
     await Deno.rename(optimizedTmpPath, finalPath)
     (race guard: if rename fails + finalPath exists → remove optimizedTmpPath, continue)
19.  now = Math.floor(Date.now() / 1000)
     optimizedRecord = { sha256: optimizedHash, size: optimizedSize, type: optimizedMime, uploaded: now }
     await insertBlob(db, optimizedRecord, auth?.pubkey ?? "anonymous")
20.  await insertMediaDerivative(db, originalHash, optimizedHash)
21.  return ctx.json(BlobDescriptor { url, sha256: optimizedHash, size, type, uploaded })
```

**Error cleanup:** Wrap steps 9–21 in try/catch. On any exception:
- `await Deno.remove(tmpPath).catch(() => {})` — original temp
- `await Deno.remove(optimizedTmpPath).catch(() => {})` — optimized temp (if it was created)
- return `errorResponse(ctx, 500, err.message)`

---

## `src/server.ts` Changes

```ts
import { buildMediaRouter } from "./routes/media.ts";

// inside buildApp(), after buildMirrorRouter():
app.route("/", buildMediaRouter(db, storageDir, config));
```

Mount order: upload → mirror → **media** → delete → blobs

---

## `deno.json` Changes

Add to `"imports"`:
```json
"fluent-ffmpeg": "npm:fluent-ffmpeg@^2.1.3",
"@types/fluent-ffmpeg": "npm:@types/fluent-ffmpeg@^2.1.27",
"file-type": "npm:file-type@^19.6.0"
```

---

## Docker Considerations

The `ffmpeg` binary must be present on the host or in the Docker image.

Add to `Dockerfile`:
```dockerfile
RUN apk add --no-cache ffmpeg
```

(Alpine-based `denoland/deno:alpine-2.x` image.)

---

## Known Legacy Bugs NOT to Port

1. **ffmpeg GIF size string bug:** Legacy builds `"${maxWidth}x${maxHeight}"` which
   stretches non-standard-aspect GIFs. Deno port should use `"?x${maxHeight}"` for
   fit-inside semantics (matching what sharp does).

2. **`removeUpload(optimizedUpload)` uncaught in happy path:** Legacy
   `src/api/media.ts:59` has no try/catch around cleanup in the success branch.
   Deno port must wrap all cleanup in `.catch(() => {})`.

3. **`src/rules/index.ts` is 0 bytes in legacy:** `getFileRule` is unresolvable.
   Deno port uses `config.upload.allowedTypes` instead of the rules engine.

---

## Open Questions (Resolved)

| Question | Decision |
|---|---|
| Image library | `npm:sharp` (already in deno.json) |
| Video library | `npm:fluent-ffmpeg` |
| ffmpeg invocation | via `fluent-ffmpeg` (not raw `Deno.Command`) |
| Worker architecture | Extend existing `UploadWorkerPool` (no new pool) |
| Original blob stored? | No — discarded after x-tag check |
| Dedup strategy | Short-circuit via `media_derivatives` DB table |
| Re-hash method | `stdCrypto.subtle.digest("SHA-256", asyncChunks)` |
| MIME allowlist | `config.upload.allowedTypes` (shared with /upload) |

## Open Questions (Unresolved)

- Should `PUT /media` respect `config.upload.maxSize` as well as `config.media.maxSize`,
  or only the media-specific limit?
- Should `HEAD /media` validate `X-Content-Type` and reject unsupported types
  (matching the BUD-06 preflight behavior of `HEAD /upload`)?
- Should the `media_derivatives` mapping be exposed in any API (e.g. return both
  hashes in the BlobDescriptor response)?
- Should `ffmpeg` path be configurable via config (for non-PATH installs)?
