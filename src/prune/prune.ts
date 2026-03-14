/**
 * Prune engine — deletes expired and ownerless blobs on a schedule.
 *
 * Two phases per run:
 *   Phase 1 — Rule-based expiry: for each storage rule, find blobs whose last
 *             access time (or upload time if never accessed) is older than the
 *             rule's expiration window, and delete them.
 *   Phase 2 — Ownerless cleanup (optional): delete blobs with no owner rows.
 *
 * Fixes vs the legacy Node.js implementation:
 *   - Expiry cutoff is `now - duration` (correct), not `now + duration` (legacy bug)
 *   - Ownerless phase calls storage.remove() to delete the physical file
 *     (legacy bug: only deleted the DB row, leaving files on disk as orphans)
 *   - Per-blob errors are caught individually; the loop always completes
 *   - Returns a summary { deleted, errors } rather than silently swallowing errors
 */

import type { Client } from "@libsql/client";
import type { StorageRule } from "../config/schema.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import {
  deleteBlob,
  getBlobsForPrune,
  getOwnerlessBlobSha256s,
} from "../db/blobs.ts";
import { mimeToExt } from "../utils/mime.ts";
import { mimeToSqlLike, parseDuration } from "./rules.ts";

export interface PruneResult {
  /** Total blobs removed (DB row + physical file) this run. */
  deleted: number;
  /** Number of individual blob deletions that failed with an error. */
  errors: number;
}

/**
 * Run one prune cycle: rule-based expiry + optional ownerless cleanup.
 *
 * Safe to call from a recurring setTimeout loop — never throws.
 * All per-blob errors are caught, counted, and logged as warnings.
 */
export async function pruneStorage(
  db: Client,
  storage: IBlobStorage,
  rules: StorageRule[],
  removeWhenNoOwners: boolean,
): Promise<PruneResult> {
  let deleted = 0;
  let errors = 0;

  // Tracks sha256 hashes processed in this run to avoid double-deletion when
  // multiple rules overlap (e.g. "image/*" and "*" could match the same blob).
  const checked = new Set<string>();

  // -------------------------------------------------------------------------
  // Phase 1 — Rule-based expiry
  // -------------------------------------------------------------------------

  const now = Math.floor(Date.now() / 1000);

  for (const rule of rules) {
    let cutoffSeconds: number;
    try {
      cutoffSeconds = now - parseDuration(rule.expiration);
    } catch (err) {
      console.warn(
        `[prune] Skipping rule (invalid expiration "${rule.expiration}"):`,
        err,
      );
      continue;
    }

    const typePattern = mimeToSqlLike(rule.type);

    let rows;
    try {
      rows = await getBlobsForPrune(db, typePattern, rule.pubkeys);
    } catch (err) {
      console.warn(
        `[prune] Failed to query blobs for rule type="${rule.type}":`,
        err,
      );
      continue;
    }

    for (const row of rows) {
      if (checked.has(row.sha256)) continue;
      checked.add(row.sha256);

      // Use last-access time preferentially; fall back to upload time if the
      // blob has never been accessed (accessed IS NULL).
      const lastSeen = row.accessed ?? row.uploaded;

      if (lastSeen < cutoffSeconds) {
        try {
          const ext = mimeToExt(row.type);
          await deleteBlob(db, row.sha256); // FK cascade removes owners + accessed rows
          await storage.remove(row.sha256, ext);
          deleted++;
        } catch (err) {
          console.warn(`[prune] Failed to delete blob ${row.sha256}:`, err);
          errors++;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2 — Ownerless blob cleanup
  // -------------------------------------------------------------------------

  if (removeWhenNoOwners) {
    let ownerless: { sha256: string; type: string | null }[];
    try {
      ownerless = await getOwnerlessBlobSha256s(db);
    } catch (err) {
      console.warn("[prune] Failed to query ownerless blobs:", err);
      ownerless = [];
    }

    for (const row of ownerless) {
      if (checked.has(row.sha256)) continue;
      checked.add(row.sha256);

      try {
        const ext = mimeToExt(row.type);
        await deleteBlob(db, row.sha256);
        await storage.remove(row.sha256, ext); // fixes legacy bug: file was never removed
        deleted++;
      } catch (err) {
        console.warn(
          `[prune] Failed to delete ownerless blob ${row.sha256}:`,
          err,
        );
        errors++;
      }
    }
  }

  return { deleted, errors };
}
