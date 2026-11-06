/**
 * Prune engine — deletes expired and ownerless blobs on a schedule.
 *
 * Two phases per run:
 *   Phase 1 — Rule-based expiry: use last access (falling back to upload time)
 *             by default, or first upload time for rules with basis: uploaded.
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
  type BlobPruneRecord,
  deleteBlob,
  getBlobsForPrune,
  getMediaThumbnailsForParent,
  getOwnerlessBlobCandidates,
  type OwnerlessScanRecord,
  type PruneCursor,
  type PruneSource,
} from "../db/blobs.ts";
import { mimeToExt } from "../utils/mime.ts";
import { mimeMatchesRule, parseDuration } from "./rules.ts";
import type { OperationMetrics } from "../metrics/operations.ts";

export interface PruneResult {
  /** Total blobs removed (DB row + physical file) this run. */
  deleted: number;
  /** Query, rule-validation, and deletion errors in this run. */
  errors: number;
}

interface RulePruneState {
  accessed?: PruneCursor;
  uploaded?: PruneCursor;
  nextSource: PruneSource;
}

export interface PruneState {
  rules: RulePruneState[];
  ownerless?: string;
}

export function createPruneState(): PruneState {
  return { rules: [] };
}

function getRuleState(state: PruneState, index: number): RulePruneState {
  return state.rules[index] ??= { nextSource: "accessed" };
}

function getGoverningRuleIndex(row: BlobPruneRecord, rules: StorageRule[]): number {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (!mimeMatchesRule(row.type, rule.type)) continue;
    const pubkeys = rule.pubkeys;
    if (pubkeys?.length && !row.owners.some((owner) => pubkeys.includes(owner))) continue;
    return index;
  }
  return -1;
}

async function getRuleCandidates(
  db: Client,
  rule: StorageRule,
  cutoff: number,
  batchSize: number,
  state: RulePruneState,
  onError: () => void,
): Promise<BlobPruneRecord[]> {
  const first = state.nextSource;
  const sources: PruneSource[] = rule.basis === "uploaded" ? ["uploaded"] : [first, first === "accessed" ? "uploaded" : "accessed"];
  if (rule.basis !== "uploaded") state.nextSource = sources[1];

  const rows: BlobPruneRecord[] = [];
  for (const source of sources) {
    const remaining = batchSize - rows.length;
    if (remaining === 0) break;

    let page: BlobPruneRecord[];
    try {
      page = await getBlobsForPrune(db, cutoff, remaining, source, state[source]);
    } catch (err) {
      console.warn(`[prune] Failed to query ${source} blobs for rule type="${rule.type}":`, err);
      onError();
      continue;
    }
    rows.push(...page);

    if (page.length < remaining) {
      state[source] = undefined;
    } else {
      const last = page.at(-1)!;
      state[source] = {
        timestamp: source === "accessed" ? last.accessed! : last.uploaded,
        sha256: last.sha256,
      };
    }
  }

  return rows;
}

/**
 * Run one prune cycle: rule-based expiry + optional ownerless cleanup.
 *
 * Safe to call from a recurring setTimeout loop — never throws.
 * All per-blob errors are caught, counted, and logged as warnings.
 *
 * Each rule and the ownerless phase examine at most `batchSize` blobs, so the
 * cost of a cycle is bounded by configuration rather than by store size.
 * Persistent cursors continue each scan next cycle and wrap after reaching the
 * end, preventing a failed row from blocking everything behind it.
 */
export async function pruneStorage(
  db: Client,
  storage: IBlobStorage,
  rules: StorageRule[],
  removeWhenNoOwners: boolean,
  batchSize = 1000,
  state = createPruneState(),
  metrics?: OperationMetrics,
): Promise<PruneResult> {
  let deleted = 0;
  let errors = 0;

  // Tracks sha256 hashes processed in this run to avoid double-deletion when
  // multiple rules overlap (e.g. "image/*" and "*" could match the same blob).
  const checked = new Set<string>();

  const now = Math.floor(Date.now() / 1000);

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    let cutoffSeconds: number;
    try {
      cutoffSeconds = now - parseDuration(rule.expiration);
    } catch (err) {
      errors++;
      console.warn(
        `[prune] Skipping rule (invalid expiration "${rule.expiration}"):`,
        err,
      );
      continue;
    }

    let rows;
    try {
      rows = await getRuleCandidates(db, rule, cutoffSeconds, batchSize, getRuleState(state, ruleIndex), () => {
        errors++;
      });
    } catch (err) {
      console.warn(
        `[prune] Failed to query blobs for rule type="${rule.type}":`,
        err,
      );
      errors++;
      continue;
    }

    for (const row of rows) {
      if (row.thumbnail) continue;
      if (rule.basis !== "uploaded" && row.pruneSource === "uploaded" && row.accessed !== null) continue;

      // SQL finds candidates for this rule, but ordered rules are a first-match
      // policy. A candidate governed by an earlier rule must never be deleted by
      // a later, shorter retention rule.
      if (getGoverningRuleIndex(row, rules) !== ruleIndex) continue;
      if (checked.has(row.sha256)) continue;
      checked.add(row.sha256);

      // Expiry is decided in SQL now, so this is a guard rather than a filter:
      // it should never reject a row. Kept because the failure it protects
      // against — a query change that widens the match — deletes user data.
      const basisTimestamp = rule.basis === "uploaded" ? row.uploaded : row.accessed ?? row.uploaded;

      if (basisTimestamp < cutoffSeconds) {
        try {
          const ext = mimeToExt(row.type);
          const thumbnails = await getMediaThumbnailsForParent(db, row.sha256);
          await deleteBlob(db, row.sha256); // FK cascade removes owners + accessed rows
          await storage.remove(row.sha256, ext);
          metrics?.add("blossom_prune_deleted_bytes_total", "", row.size, "Logical bytes removed by pruning; not physical backend usage.");
          deleted++;
          for (const thumbnail of thumbnails) {
            await deleteBlob(db, thumbnail.sha256);
            await storage.remove(thumbnail.sha256, mimeToExt(thumbnail.type));
            metrics?.add("blossom_prune_deleted_bytes_total", "", thumbnail.size, "Logical bytes removed by pruning; not physical backend usage.");
            deleted++;
          }
        } catch (err) {
          console.warn(`[prune] Failed to delete blob ${row.sha256}:`, err);
          errors++;
        }
      }
    }
  }

  if (removeWhenNoOwners) {
    let candidates: OwnerlessScanRecord[];
    try {
      candidates = await getOwnerlessBlobCandidates(db, batchSize, state.ownerless);
      state.ownerless = candidates.length < batchSize ? undefined : candidates.at(-1)!.sha256;
    } catch (err) {
      console.warn("[prune] Failed to query ownerless blobs:", err);
      errors++;
      candidates = [];
    }

    for (const row of candidates) {
      if (!row.prunable) continue;
      if (checked.has(row.sha256)) continue;
      checked.add(row.sha256);

      try {
        const ext = mimeToExt(row.type);
        const thumbnails = await getMediaThumbnailsForParent(db, row.sha256);
        await deleteBlob(db, row.sha256);
        await storage.remove(row.sha256, ext); // fixes legacy bug: file was never removed
        metrics?.add("blossom_prune_deleted_bytes_total", "", row.size, "Logical bytes removed by pruning; not physical backend usage.");
        deleted++;
        for (const thumbnail of thumbnails) {
          await deleteBlob(db, thumbnail.sha256);
          await storage.remove(thumbnail.sha256, mimeToExt(thumbnail.type));
          metrics?.add("blossom_prune_deleted_bytes_total", "", thumbnail.size, "Logical bytes removed by pruning; not physical backend usage.");
          deleted++;
        }
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
