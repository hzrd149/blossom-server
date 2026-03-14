/**
 * Storage rule helpers — pure functions, no I/O.
 *
 * Used at two callsites:
 *   1. Upload time — getFileRule() gates whether a blob is accepted
 *   2. Prune time  — mimeToSqlLike() + parseDuration() drive expiry queries
 */

import type { StorageRule } from "../config/schema.ts";

// ---------------------------------------------------------------------------
// Duration parsing
// ---------------------------------------------------------------------------

/** Seconds per named unit. Month = 30 days, year = 365 days. */
const DURATION_UNITS: Record<string, number> = {
  second: 1,
  seconds: 1,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
  day: 86400,
  days: 86400,
  week: 604800,
  weeks: 604800,
  month: 2592000, // 30 days
  months: 2592000,
  year: 31536000, // 365 days
  years: 31536000,
};

/**
 * Parse a human-readable duration string into seconds.
 * Accepts formats like "1 month", "7 days", "2 weeks", "30 minutes".
 * Throws if the string cannot be parsed.
 */
export function parseDuration(s: string): number {
  const match = s.trim().match(/^(\d+)\s*(\w+)$/);
  if (!match) throw new Error(`Invalid duration: "${s}"`);
  const count = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multiplier = DURATION_UNITS[unit];
  if (multiplier === undefined) throw new Error(`Unknown duration unit: "${unit}" in "${s}"`);
  return count * multiplier;
}

// ---------------------------------------------------------------------------
// MIME matching helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a MIME type matches a rule's type pattern.
 *
 * Pattern semantics (mirrors legacy getFileRule logic):
 *   "*"          → matches everything, including null
 *   "image/*"    → matches "image/jpeg", "image/png", etc.
 *   "image/jpeg" → exact match only
 *   null MIME    → only matches "*"
 */
export function mimeMatchesRule(mimeType: string | null, ruleType: string): boolean {
  if (ruleType === "*") return true;
  if (!mimeType) return false; // typed rule requires a MIME type
  if (mimeType === ruleType) return true;
  if (ruleType.endsWith("/*")) {
    const prefix = ruleType.slice(0, -2); // "image/*" → "image"
    return mimeType.startsWith(prefix + "/");
  }
  return false;
}

/**
 * Convert a rule type pattern to a SQL LIKE operand.
 * Used in getBlobsForPrune() to pre-filter blobs by type at the DB level.
 *
 *   "*"       → "%"
 *   "image/*" → "image/%"
 *   exact     → unchanged (still a valid LIKE pattern, no wildcards)
 */
export function mimeToSqlLike(ruleType: string): string {
  if (ruleType === "*") return "%";
  if (ruleType.endsWith("/*")) return ruleType.slice(0, -1) + "%"; // "image/*" → "image/%"
  return ruleType;
}

// ---------------------------------------------------------------------------
// Upload gate
// ---------------------------------------------------------------------------

/**
 * Find the first storage rule that matches the given MIME type and pubkey.
 * Returns null if no rule matches — callers should reject the upload.
 *
 * Rule evaluation order matches config array order (first-match wins).
 *
 * @param opts.mimeType         MIME type of the blob (null if unknown)
 * @param opts.pubkey           Uploader's Nostr pubkey (hex), if authenticated
 * @param rules                 Ordered list of storage rules from config
 * @param requirePubkeyInRule   If true, pubkey must appear in rule.pubkeys for
 *                              any pubkey-scoped rule to match an anonymous upload
 */
export function getFileRule(
  opts: { mimeType: string | null; pubkey?: string },
  rules: StorageRule[],
  requirePubkeyInRule = false,
): StorageRule | null {
  const { mimeType, pubkey } = opts;

  for (const rule of rules) {
    // Pubkey scoping: if the rule restricts to specific pubkeys, the uploader
    // must be in that list. If requirePubkeyInRule is set globally, an anonymous
    // uploader (no pubkey) can never satisfy a pubkey-scoped rule.
    if (rule.pubkeys && rule.pubkeys.length > 0) {
      if (!pubkey || !rule.pubkeys.includes(pubkey)) {
        // If requirePubkeyInRule: only pubkey-scoped rules are valid gates,
        // so we continue searching instead of skipping to an unscoped rule.
        continue;
      }
    } else if (requirePubkeyInRule) {
      // Rule has no pubkeys list but requirePubkeyInRule is set — skip unscoped rules.
      // Only rules with an explicit pubkeys allowlist can grant access.
      continue;
    }

    if (mimeMatchesRule(mimeType, rule.type)) return rule;
  }

  return null;
}
