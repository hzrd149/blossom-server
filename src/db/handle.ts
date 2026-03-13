/**
 * IDbHandle — the database interface workers program against.
 *
 * Both DbProxy (message-channel, used for local SQLite) and DirectDbHandle
 * (direct libSQL client, used for remote Turso) implement this interface.
 * Worker code imports only this type and is unaware of which backend is active.
 */

import type { BlobRecord, BlobStats } from "./blobs.ts";

export type { BlobRecord, BlobStats };

export interface IDbHandle {
  hasBlob(sha256: string): Promise<boolean>;
  getBlob(sha256: string): Promise<BlobRecord | null>;
  insertBlob(blob: BlobRecord, uploaderPubkey: string): Promise<void>;
  isOwner(sha256: string, pubkey: string): Promise<boolean>;
  getStats(): Promise<BlobStats>;
}
