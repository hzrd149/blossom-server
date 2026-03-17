import { join } from "@std/path";
import { ulid } from "@std/ulid";
import type { IBlobStorage, WriteSession } from "./interface.ts";
import { byteLimitTransform } from "../utils/streams.ts";

/**
 * Local filesystem storage adapter.
 *
 * Blobs are stored as:   <dir>/<sha256>.<ext>   (extension derived from MIME type)
 * Blobs with no known extension stored as: <dir>/<sha256>
 * Temp files written to: <dir>/.tmp/<ulid>
 *
 * Both paths are on the same filesystem, so Deno.rename() is always atomic.
 * The DB is the index: look up sha256 → get type → derive ext → open <sha256>.<ext>.
 */
export class LocalStorage implements IBlobStorage {
  readonly dir: string;
  readonly tmpDir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.tmpDir = join(dir, ".tmp");
  }

  async setup(): Promise<void> {
    await Deno.mkdir(this.dir, { recursive: true });
    await Deno.mkdir(this.tmpDir, { recursive: true });
  }

  private blobPath(hash: string, ext: string): string {
    return ext ? join(this.dir, `${hash}.${ext}`) : join(this.dir, hash);
  }

  private tmpPath(id: string): string {
    return join(this.tmpDir, id);
  }

  async has(hash: string, ext: string): Promise<boolean> {
    try {
      await Deno.stat(this.blobPath(hash, ext));
      return true;
    } catch {
      return false;
    }
  }

  async read(
    hash: string,
    ext: string,
  ): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const file = await Deno.open(this.blobPath(hash, ext), { read: true });
      return file.readable; // ReadableStream; file is closed when stream ends
    } catch {
      return null;
    }
  }

  /**
   * Native seek-based range read.
   *
   * Opens the file, seeks the read head to `start`, then streams exactly
   * (end - start + 1) bytes through a byteLimitTransform. Zero bytes are
   * read from disk before `start` — optimal for large files and late ranges.
   */
  async readRange(
    hash: string,
    ext: string,
    start: number,
    end: number,
  ): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const file = await Deno.open(this.blobPath(hash, ext), { read: true });
      await file.seek(start, Deno.SeekMode.Start);
      return file.readable.pipeThrough(byteLimitTransform(end - start + 1));
    } catch {
      return null;
    }
  }

  async size(hash: string, ext: string): Promise<number | null> {
    try {
      const stat = await Deno.stat(this.blobPath(hash, ext));
      return stat.size;
    } catch {
      return null;
    }
  }

  // Local storage doesn't store MIME type on disk — type is in the DB.
  type(_hash: string, _ext: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  async beginWrite(sizeHint: number | null): Promise<WriteSession> {
    const path = this.tmpPath(ulid());

    const file = await Deno.open(path, {
      write: true,
      create: true,
      truncate: true,
    });

    // Pipe-friendly WritableStream backed by the file
    const writable = file.writable;

    // done resolves when the writable stream is closed (file fully written)
    // writable.closed is a Promise that resolves when the stream is closed
    const done: Promise<void> =
      (writable as WritableStream & { closed?: Promise<void> }).closed ??
        new Promise<void>((resolve) => {
          // Fallback: poll — but Deno file.writable should have .closed
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

  async commitWrite(
    session: WriteSession,
    hash: string,
    ext: string,
  ): Promise<void> {
    const finalPath = this.blobPath(hash, ext);

    // If a blob with this hash already exists, discard the temp file (dedup)
    if (await this.has(hash, ext)) {
      await Deno.remove(session.tmpPath).catch(() => {});
      return;
    }

    // Atomic rename — same filesystem guaranteed by tmpDir being inside dir
    await Deno.rename(session.tmpPath, finalPath);
  }

  async abortWrite(session: WriteSession): Promise<void> {
    await Deno.remove(session.tmpPath).catch(() => {});
  }

  /**
   * Commit an already-written local file as a blob.
   * For local storage: atomically rename srcPath to the final blob path.
   * Equivalent to commitWrite but for files produced outside the
   * beginWrite/commitWrite cycle (e.g. media optimization output).
   */
  async commitFile(srcPath: string, hash: string, ext: string): Promise<void> {
    const finalPath = this.blobPath(hash, ext);

    if (await this.has(hash, ext)) {
      await Deno.remove(srcPath).catch(() => {});
      return;
    }

    await Deno.rename(srcPath, finalPath);
  }

  async remove(hash: string, ext: string): Promise<boolean> {
    try {
      await Deno.remove(this.blobPath(hash, ext));
      return true;
    } catch {
      return false;
    }
  }
}
