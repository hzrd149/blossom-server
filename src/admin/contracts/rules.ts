import { z } from "zod";
import { HEX_PUBKEY_RE, type ManagedStorageRule, ManagedStorageRulesSchema, type StorageRule } from "../../policy/rule-schema.ts";

export { ManagedStorageRuleSchema, ManagedStorageRulesSchema, RULE_TYPE_RE } from "../../policy/rule-schema.ts";
export type { ManagedStorageRule, StorageRule };

export interface RulesView {
  mode: "config" | "database";
  editable: boolean;
  /** Optimistic concurrency token; send it back with PUT /rules. */
  version: number;
  /** Full ordered list, including disabled rules. */
  rules: ManagedStorageRule[];
  /** Rules currently in config.yml (shown for comparison and reset). */
  configRules: StorageRule[];
  requirePubkeyInRule: { upload: boolean; media: boolean };
  removeWhenNoOwners: boolean;
}

export const ReplaceRulesBodySchema = z.object({
  version: z.number().int().min(0),
  rules: ManagedStorageRulesSchema,
});
export type ReplaceRulesBody = z.input<typeof ReplaceRulesBodySchema>;

export const ResetRulesBodySchema = z.object({ version: z.number().int().min(0) });

export const RuleProbeSchema = z.object({
  endpoint: z.enum(["upload", "media", "mirror"]).default("upload"),
  mimeType: z.string().trim().max(255).nullable(),
  pubkey: z.string().trim().toLowerCase().regex(HEX_PUBKEY_RE).optional(),
});
export type RuleProbe = z.input<typeof RuleProbeSchema>;

export const RulePreviewBodySchema = z.object({
  /** Proposed rules; omit to preview the saved rules. */
  rules: ManagedStorageRulesSchema.optional(),
  probes: z.array(RuleProbeSchema).max(50).default([]),
  /** Include a prune dry-run sample (costs up to batchSize rows per rule). */
  prune: z.boolean().default(false),
});
export type RulePreviewBody = z.input<typeof RulePreviewBodySchema>;

export interface RuleProbeResult {
  /** Index into the submitted (or saved) rule list, or null when no rule admits the upload. */
  ruleIndex: number | null;
  accepted: boolean;
  /** HTTP status the endpoint would return at the rule gate. */
  status: 200 | 401 | 415;
  reason: string | null;
}

export type PruneReasonDto =
  | { kind: "rule"; ruleIndex: number; basis: "accessed" | "uploaded"; basisTimestamp: number }
  | { kind: "ownerless" }
  | { kind: "thumbnail"; parent: string };

export interface PruneCandidateDto {
  sha256: string;
  size: number;
  type: string | null;
  reason: PruneReasonDto;
}

export interface RulePreviewResult {
  probes: RuleProbeResult[];
  /** First batch per rule only — a sample, not an exact count. */
  pruneSample: PruneCandidateDto[] | null;
}

export interface PruneRunDto {
  deleted: number;
  errors: number;
  started: number;
  finished: number;
  trigger: "schedule" | "manual";
}

export interface PruneStatusDto {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  nextRun: number | null;
  lastRun: PruneRunDto | null;
  batchSize: number;
}
