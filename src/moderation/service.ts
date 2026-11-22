/**
 * ModerationService — local pubkey and blob bans (docs/moderation/local-bans.md). Main thread
 * only; attached to the runtime as `runtime.moderation`.
 *
 * Request-path checks:
 * - isPubkeyBanned(): synchronous, in-memory.
 * - isHashBanned(): local raw-hash ban (one indexed lookup).
 */

import type { Client } from "@libsql/client";
import type { IBlobStorage } from "../storage/interface.ts";
import { BAN_CATEGORIES, type BanCategory, HEX64_RE, normalizePubkey } from "../policy/moderation-schema.ts";
import {
  type BannedBlobRecord,
  type BannedPubkeyRecord,
  createModerationDatabase,
  type ModerationDatabase,
  type Page,
  type PageQuery,
} from "../db/moderation/index.ts";
import { removeStoredBlob } from "./remove-blob.ts";

/** Invalid input to a moderation operation (maps to HTTP 400). */
export class ModerationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationInputError";
  }
}

export interface BanPubkeyInput {
  /** Hex or npub. */
  pubkey: string;
  reason?: BanCategory | null;
  note?: string | null;
  /** "keep" (default) leaves blobs untouched; "remove" drops the pubkey's ownership and deletes blobs left with no owners. */
  content?: "keep" | "remove";
}

export interface BanPubkeyResult {
  pubkey: string;
  /** Blobs the pubkey's ownership was removed from. */
  removedOwnership: number;
  /** Hashes whose records were deleted (orphaned blobs and their thumbnails). */
  deleted: string[];
}

export interface BanBlobInput {
  sha256: string;
  category: BanCategory;
  note?: string | null;
}

export interface BanBlobResult {
  /** Every hash that now has a ban row: the blob and its related derivative/original/thumbnails. */
  banned: string[];
  /** Hashes whose stored records were deleted. */
  deleted: string[];
  /** Reports resolved for the banned hashes. */
  reportsResolved: number;
}

export class ModerationService {
  /** Moderation queries over the runtime database. */
  readonly database: ModerationDatabase;
  private readonly bannedPubkeys = new Set<string>();

  constructor(
    db: Client,
    private readonly storage: IBlobStorage,
  ) {
    this.database = createModerationDatabase(db);
  }

  /** Load banned pubkeys into memory. */
  async init(): Promise<void> {
    this.bannedPubkeys.clear();
    for (const pubkey of await this.database.loadBannedPubkeys()) this.bannedPubkeys.add(pubkey);
  }

  // --- Request-path checks ---

  isPubkeyBanned(pubkey: string): boolean {
    return this.bannedPubkeys.has(pubkey);
  }

  /** True when the hash has a local blob ban. */
  isHashBanned(sha256: string): Promise<boolean> {
    return this.database.isBlobBanned(sha256);
  }

  // --- Pubkey bans ---

  async banPubkey(input: BanPubkeyInput): Promise<BanPubkeyResult> {
    const pubkey = normalizePubkey(input.pubkey);
    if (!pubkey) throw new ModerationInputError("Expected a 64-character hex pubkey or an npub");
    const reason = input.reason ?? null;
    if (reason !== null && !(BAN_CATEGORIES as readonly string[]).includes(reason)) throw new ModerationInputError(`Unknown ban reason "${reason}"`);
    await this.database.upsertBannedPubkey({ pubkey, reason, note: input.note?.trim() || null });
    this.bannedPubkeys.add(pubkey);

    const result: BanPubkeyResult = { pubkey, removedOwnership: 0, deleted: [] };
    if (input.content === "remove") {
      const owned = await this.database.listOwnedBlobHashes(pubkey);
      result.removedOwnership = owned.length;
      for (const orphan of await this.database.removeOwnershipReturningOrphans(pubkey, owned)) {
        result.deleted.push(...await removeStoredBlob(this.database, this.storage, orphan));
      }
    }
    console.log(`[moderation] Banned pubkey ${pubkey}${input.content === "remove" ? ` (removed ${result.deleted.length} orphaned blob(s))` : ""}`);
    return result;
  }

  async unbanPubkey(pubkey: string): Promise<boolean> {
    const hex = normalizePubkey(pubkey);
    if (!hex) throw new ModerationInputError("Expected a 64-character hex pubkey or an npub");
    this.bannedPubkeys.delete(hex);
    return await this.database.deleteBannedPubkey(hex);
  }

  getBannedPubkey(pubkey: string): Promise<BannedPubkeyRecord | null> {
    return this.database.getBannedPubkey(pubkey);
  }

  listBannedPubkeys(query: PageQuery): Promise<Page<BannedPubkeyRecord>> {
    return this.database.listBannedPubkeys(query);
  }

  // --- Blob bans ---

  /**
   * Ban a hash and its related media (derivative, original, thumbnails): record bans, delete
   * stored records and files (all owners), and resolve reports.
   */
  async banBlob(input: BanBlobInput): Promise<BanBlobResult> {
    if (!HEX64_RE.test(input.sha256)) throw new ModerationInputError("Expected a 64-character lowercase hex SHA-256");
    if (!(BAN_CATEGORIES as readonly string[]).includes(input.category)) throw new ModerationInputError(`Unknown ban category "${input.category}"`);
    const note = input.note?.trim() || null;
    // Collect relations before deleting anything: deleting a blob cascades its relation rows.
    const hashes = [input.sha256, ...await this.database.getRelatedHashes(input.sha256)];
    await this.database.upsertBannedBlobs(hashes.map((sha256) => ({ sha256, category: input.category, note })));

    const deleted: string[] = [];
    for (const hash of hashes) deleted.push(...await removeStoredBlob(this.database, this.storage, hash));
    const reportsResolved = await this.database.deleteReportsForBlobs(hashes);
    console.log(`[moderation] Banned blob ${input.sha256} (${input.category}) and ${hashes.length - 1} related hash(es)`);
    return { banned: hashes, deleted: [...new Set(deleted)], reportsResolved };
  }

  /** Lift a blob ban (this hash only). Deleted files are not restored. */
  unbanBlob(sha256: string): Promise<boolean> {
    return this.database.deleteBannedBlob(sha256);
  }

  getBannedBlob(sha256: string): Promise<BannedBlobRecord | null> {
    return this.database.getBannedBlob(sha256);
  }

  listBannedBlobs(query: PageQuery & { category?: string }): Promise<Page<BannedBlobRecord>> {
    return this.database.listBannedBlobs(query);
  }
}
