/**
 * Two-phase streaming write session.
 *
 * Usage:
 *   const session = await storage.beginWrite(contentLength);
 *   await requestBody.pipeTo(session.writable);
 *   await storage.commitWrite(session, computedHash);
 *
 * If anything goes wrong before commitWrite:
 *   await storage.abortWrite(session);
 */
export interface WriteSession {
  /** Write body bytes into this stream. Close it when done. */
  writable: WritableStream<Uint8Array>;
  /** Resolves (or rejects) when writable is fully closed/errored. */
  done: Promise<void>;
  /** Opaque identifier used by the adapter internally. */
  id: string;
}

export interface IBlobStorage {
  /** Returns true if a blob with this hash exists in storage. */
  has(hash: string): Promise<boolean>;

  /**
   * Returns a ReadableStream of the blob's bytes, or null if not found.
   * For local storage: Deno.open → file.readable (zero-copy).
   * For S3: fetch(url) → response.body (zero-copy).
   */
  read(hash: string): Promise<ReadableStream<Uint8Array> | null>;

  /** Returns the stored byte size of the blob, or null if not found. */
  size(hash: string): Promise<number | null>;

  /** Returns the stored MIME type, or null if unknown/not found. */
  type(hash: string): Promise<string | null>;

  /**
   * Begin a two-phase write.
   * @param sizeHint Content-Length in bytes, or null if unknown.
   */
  beginWrite(sizeHint: number | null): Promise<WriteSession>;

  /**
   * Commit a completed write session.
   * For local: atomically renames the temp file to <hash>.
   * For S3: calls CompleteMultipartUpload.
   *
   * @param session The session returned by beginWrite.
   * @param hash    The verified SHA-256 hex string of the written bytes.
   */
  commitWrite(session: WriteSession, hash: string): Promise<void>;

  /**
   * Abort a write session, cleaning up any temp resources.
   * Safe to call if commitWrite was already called (no-op).
   */
  abortWrite(session: WriteSession): Promise<void>;

  /** Removes a blob from storage. Returns true if it existed. */
  remove(hash: string): Promise<boolean>;
}
