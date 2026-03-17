import { S3Client } from "@bradenmacdonald/s3-lite-client";
import { join } from "@std/path";
import { ulid } from "@std/ulid";
import type { IBlobStorage, WriteSession } from "./interface.ts";
import { debug } from "../middleware/debug.ts";

/**
 * S3 storage adapter — implements IBlobStorage with a local-disk tmp buffer.
 *
 * Security model:
 *   - beginWrite() writes bytes to a local tmpDir. Zero bytes are sent to S3
 *     during the upload phase, so an attacker cannot DOS the S3 bucket by
 *     sending junk that would fail hash verification.
 *   - commitWrite() / commitFile() transfer the verified file to S3 and then
 *     delete the local tmp file. S3 only ever receives blobs whose SHA-256
 *     has been verified by the upload worker.
 *   - abortWrite() deletes the local tmp file. Nothing touches S3.
 *
 * Object key layout:
 *   <hash>.<ext>   — when ext is non-empty (e.g. "abc123...def.jpg")
 *   <hash>         — when ext is empty
 *
 * If config.publicURL is set, read() returns null and the route layer is
 * expected to redirect the client to the public URL instead of proxying.
 * When publicURL is not set, read() fetches the object from S3 and streams
 * it back zero-copy via response.body.
 */
export class S3Storage implements IBlobStorage {
  readonly tmpDir: string;

  private readonly client: S3Client;
  private readonly publicURL: string | null;

  constructor(opts: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    region?: string;
    publicURL?: string;
    tmpDir: string;
  }) {
    this.publicURL = opts.publicURL?.replace(/\/$/, "") ?? null;
    this.tmpDir = opts.tmpDir;

    this.client = new S3Client({
      endPoint: opts.endpoint,
      bucket: opts.bucket,
      accessKey: opts.accessKey,
      secretKey: opts.secretKey,
      region: opts.region ?? "us-east-1",
      pathStyle: true, // works with MinIO and most S3-compatible endpoints
    });
  }

  /**
   * Prepare local tmp directory and verify S3 bucket access.
   *
   * Lists up to one object in the bucket — enough to confirm that the
   * endpoint, credentials, and bucket name are all valid and that the
   * server has at least ListObjects permission. Throws on any failure so
   * the process exits at startup rather than silently failing at upload time.
   */
  async setup(): Promise<void> {
    await Deno.mkdir(this.tmpDir, { recursive: true });
    await this.verifyBucketAccess();
  }

  /** List up to one object to confirm bucket reachability and credentials. */
  async verifyBucketAccess(): Promise<void> {
    try {
      for await (const _obj of this.client.listObjects({ maxResults: 1 })) {
        break; // one result is enough — we just need the request to succeed
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`S3 bucket connectivity check failed: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private objectKey(hash: string, ext: string): string {
    return ext ? `${hash}.${ext}` : hash;
  }

  private tmpPath(id: string): string {
    return join(this.tmpDir, id);
  }

  // ---------------------------------------------------------------------------
  // IBlobStorage — read-side
  // ---------------------------------------------------------------------------

  async has(hash: string, ext: string): Promise<boolean> {
    try {
      await this.client.statObject(this.objectKey(hash, ext));
      return true;
    } catch {
      return false;
    }
  }

  async read(
    hash: string,
    ext: string,
  ): Promise<ReadableStream<Uint8Array> | null> {
    // If a public CDN URL is configured, the route layer should redirect
    // rather than proxy. Return null so the route falls through to its redirect
    // logic. (The blobs route checks storage.read() and, on null with a
    // publicURL config, should issue a 302. That routing logic lives in the
    // route, not here — returning null is the correct signal.)
    if (this.publicURL) {
      return null;
    }

    try {
      const response = await this.client.getObject(this.objectKey(hash, ext));
      if (!response.body) return null;
      return response.body as ReadableStream<Uint8Array>;
    } catch {
      return null;
    }
  }

  /**
   * Native S3 range read using getPartialObject.
   *
   * Issues a GET request with a Range header directly to S3 — zero bytes
   * are transferred before `start`. When publicURL is set, returns null
   * so the route layer can redirect the client (the client will include
   * its own Range header in the redirect request).
   */
  async readRange(
    hash: string,
    ext: string,
    start: number,
    end: number,
  ): Promise<ReadableStream<Uint8Array> | null> {
    // With publicURL, the route redirects the client. The client is responsible
    // for sending its own Range header to the CDN — we must not proxy here.
    if (this.publicURL) {
      return null;
    }

    try {
      const response = await this.client.getPartialObject(
        this.objectKey(hash, ext),
        { offset: start, length: end - start + 1 },
      );
      if (!response.body) return null;
      return response.body as ReadableStream<Uint8Array>;
    } catch {
      return null;
    }
  }

  async size(hash: string, ext: string): Promise<number | null> {
    try {
      const stat = await this.client.statObject(this.objectKey(hash, ext));
      return stat.size ?? null;
    } catch {
      return null;
    }
  }

  // S3 storage does not store MIME type — type is in the DB.
  type(_hash: string, _ext: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // ---------------------------------------------------------------------------
  // IBlobStorage — write-side (local tmp buffer)
  // ---------------------------------------------------------------------------

  /**
   * Begin a write session. The body is written to local disk only.
   * Zero bytes are sent to S3 until commitWrite() is called.
   */
  async beginWrite(sizeHint: number | null): Promise<WriteSession> {
    const path = this.tmpPath(ulid());

    const file = await Deno.open(path, {
      write: true,
      create: true,
      truncate: true,
    });

    const writable = file.writable;

    // done resolves when the writable stream is closed (file fully written).
    const done: Promise<void> =
      (writable as WritableStream & { closed?: Promise<void> }).closed ??
        new Promise<void>((resolve) => {
          const interval = setInterval(async () => {
            try {
              const stat = await Deno.stat(path);
              if (sizeHint !== null && stat.size >= sizeHint) {
                clearInterval(interval);
                resolve();
              }
            } catch {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        });

    return { tmpPath: path, writable, done };
  }

  /**
   * Commit a completed write session to S3.
   *
   * Streams the local tmp file to S3 as the final object, then deletes the
   * tmp file. Only called after the upload worker has verified the SHA-256
   * hash — S3 never receives unverified bytes.
   */
  async commitWrite(
    session: WriteSession,
    hash: string,
    ext: string,
  ): Promise<void> {
    await this._uploadToS3AndCleanup(session.tmpPath, hash, ext);
  }

  /**
   * Abort a write session. Deletes the local tmp file only.
   * Nothing is sent to or removed from S3.
   */
  async abortWrite(session: WriteSession): Promise<void> {
    await Deno.remove(session.tmpPath).catch(() => {});
  }

  /**
   * Commit an already-written local file to S3 as the final blob.
   * Used by the media route after optimization: the optimized output is a
   * local file that needs to be transferred to S3 and then removed.
   */
  async commitFile(srcPath: string, hash: string, ext: string): Promise<void> {
    await this._uploadToS3AndCleanup(srcPath, hash, ext);
  }

  async remove(hash: string, ext: string): Promise<boolean> {
    try {
      await this.client.deleteObject(this.objectKey(hash, ext));
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: stream local file → S3 then delete local file
  // ---------------------------------------------------------------------------

  private async _uploadToS3AndCleanup(
    srcPath: string,
    hash: string,
    ext: string,
  ): Promise<void> {
    const t0 = Date.now();
    debug(`[s3:commit] start hash=${hash} ext=${ext} src=${srcPath}`);

    const key = this.objectKey(hash, ext);

    // Check for existing object — dedup, avoid redundant PUT
    const t1 = Date.now();
    debug(`[s3:commit] checking dedup via has() hash=${hash}`);
    const alreadyExists = await this.has(hash, ext);
    const t2 = Date.now();
    if (alreadyExists) {
      debug(
        `[s3:commit] dedup hit — skipping putObject hash=${hash} elapsed=${
          t2 - t1
        }ms`,
      );
      await Deno.remove(srcPath).catch(() => {});
      return;
    }

    const stat = await Deno.stat(srcPath);
    debug(`[s3:commit] opening local file size=${stat.size} bytes`);

    const file = await Deno.open(srcPath, { read: true });

    try {
      debug(`[s3:commit] putObject start key=${key} size=${stat.size} bytes`);
      const t3 = Date.now();
      await this.client.putObject(key, file.readable, {
        size: stat.size,
      });
      const t4 = Date.now();
      debug(
        `[s3:commit] putObject complete key=${key} elapsed=${t4 - t3}ms total=${
          t4 - t0
        }ms`,
      );
    } finally {
      // Some stream consumers may already close the file descriptor.
      // Ignore "BadResource" so successful uploads don't fail in cleanup.
      try {
        debug(`[s3:commit] closing file handle hash=${hash}`);
        file.close();
      } catch {
        // no-op
      }
      // Ensure the local tmp file is always removed, even on upload error.
      // The caller (commitWrite / commitFile) is responsible for deciding
      // whether to retry or surface the error.
      const t5 = Date.now();
      await Deno.remove(srcPath).catch(() => {});
      const t6 = Date.now();
      debug(
        `[s3:commit] removed local tmp file elapsed=${t6 - t5}ms total=${
          t6 - t0
        }ms`,
      );
    }
  }
}
