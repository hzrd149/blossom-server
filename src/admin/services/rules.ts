import type { Config } from "../../config/schema.ts";
import { getFileRule, pubkeyAllowedByRules } from "../../prune/rules.ts";
import { type ManagedStorageRule, toActiveRules } from "../../policy/rule-schema.ts";
import type { ServerRuntime } from "../../runtime.ts";
import type { PruneCandidateDto, PruneStatusDto, RulePreviewBodySchema, RulePreviewResult, RuleProbeResult, RulesView } from "../contracts/rules.ts";
import type { z } from "zod";

/** Indices into `entries` of the enabled rules, aligned with toActiveRules(entries). */
function activeIndexMap(entries: readonly ManagedStorageRule[]): number[] {
  return entries.flatMap((rule, index) => rule.enabled === false ? [] : [index]);
}

export function createRuleService(config: Config, runtime: ServerRuntime) {
  const view = (): RulesView => ({
    mode: runtime.rules.mode,
    editable: runtime.rules.editable,
    version: runtime.rules.version,
    rules: runtime.rules.entries(),
    configRules: runtime.rules.configured(),
    requirePubkeyInRule: { upload: config.upload.requirePubkeyInRule, media: config.media.requirePubkeyInRule },
    removeWhenNoOwners: config.storage.removeWhenNoOwners,
  });

  return {
    view,
    async replace(rules: ManagedStorageRule[], version: number): Promise<RulesView> {
      await runtime.rules.replace(rules, version);
      return view();
    },
    async reset(version: number): Promise<RulesView> {
      await runtime.rules.resetToConfig(version);
      return view();
    },
    /** Evaluate upload probes and (optionally) a prune sample against proposed or saved rules. */
    async preview(body: z.output<typeof RulePreviewBodySchema>): Promise<RulePreviewResult> {
      const entries = body.rules ?? runtime.rules.entries();
      const active = toActiveRules(entries);
      const indexMap = activeIndexMap(entries);

      const probes = body.probes.map((probe): RuleProbeResult => {
        const require = probe.endpoint === "media" ? config.media.requirePubkeyInRule : config.upload.requirePubkeyInRule;
        if (probe.endpoint === "mirror" && !pubkeyAllowedByRules(probe.pubkey, active, require)) {
          return { ruleIndex: null, accepted: false, status: 401, reason: "Pubkey is not in any storage rule allowlist" };
        }
        const rule = getFileRule({ mimeType: probe.mimeType, pubkey: probe.pubkey }, active, require);
        if (!rule) {
          return {
            ruleIndex: null,
            accepted: false,
            status: require ? 401 : 415,
            reason: require ? "No storage rule admits this pubkey and type" : "No storage rule matches this type",
          };
        }
        return { ruleIndex: indexMap[active.indexOf(rule)], accepted: true, status: 200, reason: null };
      });

      let pruneSample: PruneCandidateDto[] | null = null;
      if (body.prune) {
        pruneSample = (await runtime.prune.dryRun(active)).map((candidate) => ({
          ...candidate,
          reason: candidate.reason.kind === "rule" ? { ...candidate.reason, ruleIndex: indexMap[candidate.reason.ruleIndex] } : candidate.reason,
        }));
      }
      return { probes, pruneSample };
    },
  };
}

export function createPruneService(config: Config, runtime: ServerRuntime) {
  return {
    status: (): PruneStatusDto => ({ ...runtime.prune.status(), batchSize: config.prune.batchSize }),
    /** Start a cycle in the background; false when one is already running. */
    trigger(): boolean {
      const run = runtime.prune.trigger();
      if (!run) return false;
      run.catch((err) => console.error("[admin] Manual prune failed:", err));
      return true;
    },
  };
}
