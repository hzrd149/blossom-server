/**
 * Storage rule helpers — pure functions, no I/O.
 *
 * Used at upload time to select a rule and at prune time to evaluate retention.
 */

import type { StorageRule } from "../policy/rule-schema.ts";

import { parseDuration } from "../policy/rule-schema.ts";

export { parseDuration };

/**
 * Whether a pubkey would be allowed by ANY rule under requirePubkeyInRule
 * semantics — i.e. it appears in at least one rule's pubkeys allowlist.
 *
 * Used by PUT /mirror to reject non-allowlisted uploaders BEFORE fetching
 * the origin: without this, a non-allowlisted authenticated key could make
 * the server issue outbound HTTP requests (SSRF-guarded, but still an
 * unintended capability) whose results it would never be allowed to store.
 */
export function pubkeyAllowedByRules(
  pubkey: string | undefined,
  rules: StorageRule[],
  requirePubkeyInRule: boolean,
): boolean {
  if (!requirePubkeyInRule) return true;
  if (!pubkey) return false;
  return rules.some(
    (rule) => rule.pubkeys !== undefined && rule.pubkeys.includes(pubkey),
  );
}

/**
 * Returns true if a MIME type matches a rule's type pattern.
 *
 * Pattern semantics (mirrors legacy getFileRule logic):
 *   "*"          → matches everything, including null
 *   "image/*"    → matches "image/jpeg", "image/png", etc.
 *   "image/jpeg" → exact match only
 *   null MIME    → only matches "*"
 */
export function mimeMatchesRule(
  mimeType: string | null,
  ruleType: string,
): boolean {
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

/**
 * Index of the rule that governs an existing blob's retention, or -1.
 *
 * Retention is first-match over the ordered rules: a pubkey-scoped rule applies
 * when ANY owner is in its pubkeys list. Unlike getFileRule (the upload gate),
 * requirePubkeyInRule is not considered — it controls admission, not retention.
 */
export function getGoverningRuleIndex(
  blob: { type: string | null; owners: readonly string[] },
  rules: readonly StorageRule[],
): number {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (!mimeMatchesRule(blob.type, rule.type)) continue;
    const pubkeys = rule.pubkeys;
    if (pubkeys?.length && !blob.owners.some((owner) => pubkeys.includes(owner))) continue;
    return index;
  }
  return -1;
}

/**
 * Unix time at which a blob governed by `rule` becomes eligible for pruning,
 * or null when the rule's expiration is invalid.
 */
export function computeExpiry(
  blob: { uploaded: number; accessed: number | null },
  rule: StorageRule,
): number | null {
  try {
    const basis = rule.basis === "uploaded" ? blob.uploaded : blob.accessed ?? blob.uploaded;
    return basis + parseDuration(rule.expiration);
  } catch {
    return null;
  }
}
