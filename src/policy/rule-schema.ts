/**
 * Storage rule schema and duration parsing — pure, browser-safe (imports zod and the pure NIP-05 domain helper only).
 *
 * Shared by runtime configuration, the rule store, and admin API contracts.
 */

import { z } from "zod";
import { normalizeNip05Domain } from "../allowlist/nip05-domain.ts";

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

/** A bare NIP-05 domain, normalized to its URL host (lowercase, punycode). */
const Nip05DomainSchema = z.string().transform((domain, ctx) => {
  try {
    return normalizeNip05Domain(domain);
  } catch (err) {
    ctx.addIssue({ code: "custom", message: err instanceof Error ? err.message : String(err) });
    return z.NEVER;
  }
});

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
  nip05Domains: z
    .array(Nip05DomainSchema)
    .optional()
    .describe(
      "Optional list of NIP-05 domains. Every pubkey listed in https://<domain>/.well-known/nostr.json is added to this rule's pubkeys allowlist. " +
        "Fetched at startup and refreshed every storage.nip05.refreshIntervalMs. A rule with domains stays pubkey-scoped even while no members have been fetched. " +
        "The domain must return its full names map when queried without ?name=.",
    ),
  enabled: z
    .boolean()
    .optional()
    .describe("Set to false to keep the rule in the file but skip it during evaluation. Defaults to true."),
  note: z
    .string()
    .optional()
    .describe("Optional free-form note shown in the admin console. Has no effect on evaluation."),
});

/** A rule as written in config.yml: possibly disabled, possibly carrying a note. */
export type ConfiguredStorageRule = z.infer<typeof StorageRuleSchema>;

/** An evaluated rule, as produced by toActiveRules(): enabled only, no editor metadata. */
export type StorageRule = Omit<ConfiguredStorageRule, "enabled" | "note">;

/** MIME pattern accepted by the console rule editor: "*", "type/*", or "type/subtype". */
export const RULE_TYPE_RE = /^(\*|[a-z0-9][a-z0-9.+-]*\/(\*|[a-z0-9][a-z0-9.+_-]*))$/;
export const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;
export const MAX_STORAGE_RULES = 100;

/**
 * A storage rule as submitted by the admin console rule builder. Stricter than
 * StorageRuleSchema, which stays lenient for backward-compatible config files.
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
  nip05Domains: z.array(Nip05DomainSchema).max(100).optional(),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(500).optional(),
});

export type ManagedStorageRule = z.input<typeof ManagedStorageRuleSchema>;

export const ManagedStorageRulesSchema = z.array(ManagedStorageRuleSchema).max(MAX_STORAGE_RULES);

/** Strip editor metadata and drop disabled rules, producing the evaluated rule list. */
export function toActiveRules(rules: readonly (StorageRule & { enabled?: boolean })[]): StorageRule[] {
  return rules.filter((rule) => rule.enabled !== false).map(({ type, expiration, basis, pubkeys, nip05Domains }) => ({
    type,
    expiration,
    ...(basis ? { basis } : {}),
    ...(pubkeys?.length ? { pubkeys } : {}),
    ...(nip05Domains?.length ? { nip05Domains } : {}),
  }));
}
