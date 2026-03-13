/**
 * DirectDbHandle — IDbHandle implementation for remote libSQL / Turso.
 *
 * Wraps a real @libsql/client Client and delegates to the same named functions
 * in src/db/blobs.ts that the main thread uses. Workers instantiate this
 * directly (no MessageChannel needed) because a network-backed libSQL client
 * is thread-safe and has no file-handle affinity.
 */

import type { Client } from "@libsql/client";
import {
  getBlobStats,
  getBlob,
  hasBlob,
  insertBlob,
  isOwner,
} from "./blobs.ts";
import type { IDbHandle } from "./handle.ts";
import type { BlobRecord, BlobStats } from "./blobs.ts";

export class DirectDbHandle implements IDbHandle {
  constructor(private client: Client) {}

  hasBlob(sha256: string): Promise<boolean> {
    return hasBlob(this.client, sha256);
  }

  getBlob(sha256: string): Promise<BlobRecord | null> {
    return getBlob(this.client, sha256);
  }

  insertBlob(blob: BlobRecord, uploaderPubkey: string): Promise<void> {
    return insertBlob(this.client, blob, uploaderPubkey);
  }

  isOwner(sha256: string, pubkey: string): Promise<boolean> {
    return isOwner(this.client, sha256, pubkey);
  }

  getStats(): Promise<BlobStats> {
    return getBlobStats(this.client);
  }
}
