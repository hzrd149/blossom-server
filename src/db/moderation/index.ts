/**
 * ModerationDatabase — the only database access of moderation and stored-blob removal code
 * (src/moderation/). Wraps a libsql Client once; domain code never holds the Client.
 * SQL lives in ./bans.ts (local bans) and src/db/blobs.ts (stored blob records). Multi-statement
 * writes are exposed as intent-named operations; statement builders stay private to the db layer.
 */

import type { Client } from "@libsql/client";
import * as blobs from "../blobs.ts";
import type { BlobRecord } from "../blobs.ts";
import * as bans from "./bans.ts";
import type { BannedBlobRecord, BannedPubkeyRecord, Page, PageQuery } from "./bans.ts";

export type { BlobRecord } from "../blobs.ts";
export type { BannedBlobRecord, BannedPubkeyRecord, Page, PageQuery } from "./bans.ts";

export interface ModerationDatabase {
  // --- Pubkey bans ---

  /** Every banned pubkey (loaded into memory at startup). */
  loadBannedPubkeys(): Promise<string[]>;
  getBannedPubkey(pubkey: string): Promise<BannedPubkeyRecord | null>;
  /** Insert or update a pubkey ban. Keeps the original `created` on update. */
  upsertBannedPubkey(record: Omit<BannedPubkeyRecord, "created"> & { created?: number }): Promise<void>;
  deleteBannedPubkey(pubkey: string): Promise<boolean>;
  listBannedPubkeys(query: PageQuery): Promise<Page<BannedPubkeyRecord>>;
  /** Hashes of every blob the pubkey owns. */
  listOwnedBlobHashes(pubkey: string): Promise<string[]>;
  /** Remove a pubkey's ownership from the given blobs and return those left with no owners (thumbnails of other blobs excepted). */
  removeOwnershipReturningOrphans(pubkey: string, hashes: readonly string[]): Promise<string[]>;

  // --- Blob bans ---

  getBannedBlob(sha256: string): Promise<BannedBlobRecord | null>;
  isBlobBanned(sha256: string): Promise<boolean>;
  /** Transaction: insert or update blob bans. */
  upsertBannedBlobs(records: readonly Omit<BannedBlobRecord, "created">[], created?: number): Promise<void>;
  /** Lift a blob ban. Returns false when the hash was not banned. */
  deleteBannedBlob(sha256: string): Promise<boolean>;
  listBannedBlobs(query: PageQuery & { category?: string }): Promise<Page<BannedBlobRecord>>;
  /** Derivative, originals, and thumbnails related to a blob by media processing (excluding `sha256`). */
  getRelatedHashes(sha256: string): Promise<string[]>;
  /** Resolve (delete) every report for the given hashes. Returns the number removed. */
  deleteReportsForBlobs(hashes: readonly string[]): Promise<number>;

  // --- Stored blobs ---

  getBlob(sha256: string): Promise<BlobRecord | null>;
  deleteBlob(sha256: string): Promise<boolean>;
  getMediaThumbnailsForParent(parentSha256: string): Promise<BlobRecord[]>;
  /** True when a thumbnail has owners or is the thumbnail of a stored blob other than `parent`. */
  isThumbnailStillUsed(thumbnail: string, parent: string): Promise<boolean>;
}

export function createModerationDatabase(db: Client): ModerationDatabase {
  return {
    // Pubkey bans
    loadBannedPubkeys: () => bans.loadBannedPubkeys(db),
    getBannedPubkey: (pubkey) => bans.getBannedPubkey(db, pubkey),
    upsertBannedPubkey: (record) => bans.upsertBannedPubkey(db, record),
    deleteBannedPubkey: (pubkey) => bans.deleteBannedPubkey(db, pubkey),
    listBannedPubkeys: (query) => bans.listBannedPubkeys(db, query),
    listOwnedBlobHashes: (pubkey) => bans.listOwnedBlobHashes(db, pubkey),
    removeOwnershipReturningOrphans: (pubkey, hashes) => bans.removeOwnershipReturningOrphans(db, pubkey, hashes),

    // Blob bans
    getBannedBlob: (sha256) => bans.getBannedBlob(db, sha256),
    isBlobBanned: (sha256) => bans.isBlobBanned(db, sha256),
    upsertBannedBlobs: (records, created) => bans.upsertBannedBlobs(db, records, created),
    deleteBannedBlob: (sha256) => bans.deleteBannedBlob(db, sha256),
    listBannedBlobs: (query) => bans.listBannedBlobs(db, query),
    getRelatedHashes: (sha256) => bans.getRelatedHashes(db, sha256),
    deleteReportsForBlobs: (hashes) => bans.deleteReportsForBlobs(db, hashes),

    // Stored blobs
    getBlob: (sha256) => blobs.getBlob(db, sha256),
    deleteBlob: (sha256) => blobs.deleteBlob(db, sha256),
    getMediaThumbnailsForParent: (parentSha256) => blobs.getMediaThumbnailsForParent(db, parentSha256),
    isThumbnailStillUsed: (thumbnail, parent) => bans.isThumbnailStillUsed(db, thumbnail, parent),
  };
}
