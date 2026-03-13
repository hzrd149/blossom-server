import { join } from "@std/path";
import { ulid } from "@std/ulid";
import type { IBlobStorage, WriteSession } from "./interface.ts";

/**
 * Local filesystem storage adapter.
 *
 * Blobs are stored as:   <dir>/<sha256>          (no extension — type stored in DB)
 * Temp files written to: <dir>/.tmp/<ulid>
 *
 * Both paths are on the same filesystem, so Deno.rename() is always atomic.
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

  private blobPath(hash: string): string {
    return join(this.dir, hash);
  }

  private tmpPath(id: string): string {
    return join(this.tmpDir, id);
  }

  async has(hash: string): Promise<boolean> {
    try {
      await Deno.stat(this.blobPath(hash));
      return true;
    } catch {
      return false;
    }
  }

  async read(hash: string): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const file = await Deno.open(this.blobPath(hash), { read: true });
      return file.readable; // ReadableStream; file is closed when stream ends
    } catch {
      return null;
    }
  }

  async size(hash: string): Promise<number | null> {
    try {
      const stat = await Deno.stat(this.blobPath(hash));
      return stat.size;
    } catch {
      return null;
    }
  }

  // Local storage doesn't store MIME type on disk — type is in the DB.
  async type(_hash: string): Promise<string | null> {
    return null;
  }

  async beginWrite(sizeHint: number | null): Promise<WriteSession> {
    const id = ulid();
    const path = this.tmpPath(id);

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

    return { id, writable, done };
  }

  async commitWrite(session: WriteSession, hash: string): Promise<void> {
    const tmpPath = this.tmpPath(session.id);
    const finalPath = this.blobPath(hash);

    // If a blob with this hash already exists, discard the temp file (dedup)
    if (await this.has(hash)) {
      await Deno.remove(tmpPath).catch(() => {});
      return;
    }

    // Atomic rename — same filesystem guaranteed by tmpDir being inside dir
    await Deno.rename(tmpPath, finalPath);
  }

  async abortWrite(session: WriteSession): Promise<void> {
    const tmpPath = this.tmpPath(session.id);
    await Deno.remove(tmpPath).catch(() => {});
  }

  async remove(hash: string): Promise<boolean> {
    try {
      await Deno.remove(this.blobPath(hash));
      return true;
    } catch {
      return false;
    }
  }
}
