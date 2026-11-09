/**
 * Storage rule schema and duration parsing — pure, browser-safe (imports zod only).
 *
 * Shared by runtime configuration, the rule store, and admin API contracts.
 */

import { z } from "zod";

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
  if (multiplier === undefined) {
    throw new Error(`Unknown duration unit: "${unit}" in "${s}"`);
  }
  return count * multiplier;
}

export const StorageRuleSchema = z.object({
  type: z
    .string()
    .describe(
      'MIME type pattern to match. Supports glob wildcards: "image/*" matches all image types, "*" matches everything.',
    ),
  expiration: z
    .string()
    .describe(
      'Retention duration measured from the rule basis. Human-readable duration: "7 days", "1 month", "24 hours".',
    ),
  basis: z
    .enum(["accessed", "uploaded"])
    .optional()
    .describe(
      'Expiration basis: "accessed" (default) uses last access, falling back to upload time; "uploaded" uses first upload to this server, regardless of later access or repeat uploads.',
    ),
  pubkeys: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of Nostr pubkeys (hex) this rule applies to. When set, only blobs uploaded by one of these pubkeys are matched.",
    ),
});

export type StorageRule = z.infer<typeof StorageRuleSchema>;

/** MIME pattern accepted by the console rule editor: "*", "type/*", or "type/subtype". */
export const RULE_TYPE_RE = /^(\*|[a-z0-9][a-z0-9.+-]*\/(\*|[a-z0-9][a-z0-9.+_-]*))$/;
export const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;
export const MAX_STORAGE_RULES = 100;

/**
 * A storage rule as managed by the admin console. Stricter than StorageRuleSchema
 * (which stays lenient for backward-compatible config files) and adds editor metadata.
 */
export const ManagedStorageRuleSchema = z.object({
  type: z.string().trim().toLowerCase().regex(RULE_TYPE_RE, 'Expected "*", "type/*", or "type/subtype"'),
  expiration: z.string().trim().refine((value) => {
    try {
      return parseDuration(value) > 0;
    } catch {
      return false;
    }
  }, 'Expected a positive duration such as "7 days" or "1 month"'),
  basis: z.enum(["accessed", "uploaded"]).optional(),
  pubkeys: z.array(z.string().trim().toLowerCase().regex(HEX_PUBKEY_RE, "Expected a 64-character hex pubkey")).max(1000)
    .optional(),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(500).optional(),
});

export type ManagedStorageRule = z.input<typeof ManagedStorageRuleSchema>;

export const ManagedStorageRulesSchema = z.array(ManagedStorageRuleSchema).max(MAX_STORAGE_RULES);

/** Strip editor metadata and drop disabled rules, producing the evaluated rule list. */
export function toActiveRules(rules: readonly ManagedStorageRule[]): StorageRule[] {
  return rules.filter((rule) => rule.enabled !== false).map(({ type, expiration, basis, pubkeys }) => ({
    type,
    expiration,
    ...(basis ? { basis } : {}),
    ...(pubkeys?.length ? { pubkeys } : {}),
  }));
}
