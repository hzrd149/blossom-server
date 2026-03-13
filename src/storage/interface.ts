/**
 * Two-phase streaming write session.
 *
 * Usage:
 *   const session = await storage.beginWrite(contentLength);
 *   await requestBody.pipeTo(session.writable);
 *   await storage.commitWrite(session, computedHash, ext);
 *
 * If anything goes wrong before commitWrite:
 *   await storage.abortWrite(session);
 */
export interface WriteSession {
  /** Write body bytes into this stream. Close it when done. */
  writable: WritableStream<Uint8Array>;
  /** Resolves (or rejects) when writable is fully closed/errored. */
  done: Promise<void>;
  /**
   * Absolute path to the local temp file where bytes are being written.
   * The upload worker receives this path and opens the file for writing
   * directly (bypassing the writable stream). The storage adapter uses it
   * internally for commitWrite / abortWrite cleanup.
   */
  tmpPath: string;
}

export interface IBlobStorage {
  /** Returns true if a blob with this hash exists in storage. */
  has(hash: string, ext: string): Promise<boolean>;

  /**
   * Returns a ReadableStream of the blob's bytes, or null if not found.
   * For local storage: Deno.open → file.readable (zero-copy).
   * For S3: fetch(url) → response.body (zero-copy).
   */
  read(hash: string, ext: string): Promise<ReadableStream<Uint8Array> | null>;

  /** Returns the stored byte size of the blob, or null if not found. */
  size(hash: string, ext: string): Promise<number | null>;

  /** Returns the stored MIME type, or null if unknown/not found. */
  type(hash: string, ext: string): Promise<string | null>;

  /**
   * Begin a two-phase write.
   * @param sizeHint Content-Length in bytes, or null if unknown.
   */
  beginWrite(sizeHint: number | null): Promise<WriteSession>;

  /**
   * Commit a completed write session.
   * For local: atomically renames the temp file to <hash>.<ext> (or <hash> if ext is empty).
   * For S3: calls CompleteMultipartUpload.
   *
   * @param session The session returned by beginWrite.
   * @param hash    The verified SHA-256 hex string of the written bytes.
   * @param ext     The file extension (without dot), e.g. "jpg". Empty string if unknown.
   */
  commitWrite(session: WriteSession, hash: string, ext: string): Promise<void>;

  /**
   * Abort a write session, cleaning up any temp resources.
   * Safe to call if commitWrite was already called (no-op).
   */
  abortWrite(session: WriteSession): Promise<void>;

  /**
   * Commit an already-written local file into storage as a blob.
   * Used by the media route after optimization: the optimized file is on local
   * disk and needs to be committed to the final storage location.
   *
   * For local: atomically renames srcPath to <hash>.<ext> (or <hash> if ext is empty).
   * For S3: streams srcPath to S3 as the final object key, then removes srcPath.
   *
   * @param srcPath Absolute path to the source file on local disk.
   * @param hash    The verified SHA-256 hex string of the file's bytes.
   * @param ext     The file extension (without dot), e.g. "jpg". Empty string if unknown.
   */
  commitFile(srcPath: string, hash: string, ext: string): Promise<void>;

  /** Removes a blob from storage. Returns true if it existed. */
  remove(hash: string, ext: string): Promise<boolean>;
}
