import { z } from "zod";
import { HEX_PUBKEY_RE, type ManagedStorageRule, ManagedStorageRulesSchema, type StorageRule } from "../../policy/rule-schema.ts";

export { ManagedStorageRuleSchema, ManagedStorageRulesSchema, RULE_TYPE_RE } from "../../policy/rule-schema.ts";
export type { ManagedStorageRule, StorageRule };

export interface ConfigFileView {
  /** Config path the server was started with; null when unknown (the console can only generate a file). */
  path: string | null;
  exists: boolean;
  /** The server can write the file; saving applies the new rules immediately. */
  writable: boolean;
  /** Optimistic-concurrency token for the file contents; send it back with PUT /rules. */
  hash: string | null;
  /** Set when the file on disk cannot be parsed or validated. */
  error: string | null;
  /** storage.rules in the file on disk match the rules in effect. False after a hand edit; POST /rules/reload applies it. */
  inSync: boolean;
}

export interface RulesView {
  /** Rules in effect, in evaluation order, including disabled rules. */
  rules: ManagedStorageRule[];
  /** In-memory rule set version; changes whenever rules are applied. */
  version: number;
  configFile: ConfigFileView;
  requirePubkeyInRule: { upload: boolean; media: boolean };
  removeWhenNoOwners: boolean;
}

export const SaveRulesBodySchema = z.object({
  /** ConfigFileView.hash the edit was based on. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  rules: ManagedStorageRulesSchema,
});
export type SaveRulesBody = z.input<typeof SaveRulesBodySchema>;

export const RenderRulesBodySchema = z.object({ rules: ManagedStorageRulesSchema });
export type RenderRulesBody = z.input<typeof RenderRulesBodySchema>;

export interface RenderedConfig {
  /** Full config.yml with storage.rules replaced; the rest of the file is kept as-is (uninterpolated). */
  text: string;
  /** Just the storage.rules section. */
  snippet: string;
  /** Hash of the file the text was rendered from (null when there is no file). */
  hash: string | null;
}

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
