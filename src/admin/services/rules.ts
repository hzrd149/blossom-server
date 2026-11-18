import type { Config } from "../../config/schema.ts";
import { getFileRule, pubkeyAllowedByRules } from "../../prune/rules.ts";
import type { ConfiguredStorageRule, ManagedStorageRule } from "../../policy/rule-schema.ts";
import type { ServerRuntime } from "../../runtime.ts";
import { InvalidConfigError, parseConfigText } from "../../config/loader.ts";
import {
  cleanRule,
  ConfigChangedError,
  type ConfigFileState,
  ConfigNotWritableError,
  readConfigFile,
  renderConfigWithRules,
  renderRulesSnippet,
  writeConfigFile,
} from "../../config/editor.ts";
import type {
  ConfigFileView,
  PruneCandidateDto,
  PruneStatusDto,
  RenderedConfig,
  RulePreviewBodySchema,
  RulePreviewResult,
  RuleProbeResult,
  RulesView,
} from "../contracts/rules.ts";
import type { z } from "zod";

/** Indices into `entries` of the enabled rules, aligned with toActiveRules(entries). */
function activeIndexMap(entries: readonly ManagedStorageRule[]): number[] {
  return entries.flatMap((rule, index) => rule.enabled === false ? [] : [index]);
}

function sameRules(a: readonly ConfiguredStorageRule[], b: readonly ConfiguredStorageRule[]): boolean {
  return JSON.stringify(a.map(cleanRule)) === JSON.stringify(b.map(cleanRule));
}

/**
 * Storage rules are owned by config.yml. Saving renders the edited rules into the
 * file (when the server can write it) and applies them immediately; otherwise the
 * console renders the file for the operator to copy into place.
 */
export function createRuleService(config: Config, runtime: ServerRuntime, configPath?: string) {
  function fileView(state: ConfigFileState): ConfigFileView {
    let error: string | null = null;
    let inSync = true;
    if (state.exists) {
      try {
        inSync = sameRules(parseConfigText(state.text, { quiet: true }).storage.rules, runtime.rules.entries());
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        inSync = false;
      }
    }
    return { path: state.path, exists: state.exists, writable: state.writable, hash: state.hash, error, inSync };
  }

  async function view(state?: ConfigFileState): Promise<RulesView> {
    return {
      rules: runtime.rules.entries(),
      version: runtime.rules.version,
      configFile: fileView(state ?? await readConfigFile(configPath)),
      requirePubkeyInRule: { upload: config.upload.requirePubkeyInRule, media: config.media.requirePubkeyInRule },
      removeWhenNoOwners: config.storage.removeWhenNoOwners,
    };
  }

  /** Render the current file with `rules` and validate the result as a whole configuration. */
  function render(state: ConfigFileState, rules: readonly ConfiguredStorageRule[]): { text: string; config: Config } {
    const text = renderConfigWithRules(state.text, rules);
    return { text, config: parseConfigText(text, { quiet: true }) };
  }

  return {
    view: () => view(),

    /** Full config.yml (and a rules-only snippet) with `rules` in place, for copying or review. */
    async render(rules: ConfiguredStorageRule[]): Promise<RenderedConfig> {
      const state = await readConfigFile(configPath);
      return { text: render(state, rules).text, snippet: renderRulesSnippet(rules), hash: state.hash };
    },

    /** Write `rules` into config.yml and apply them. `hash` must match the file on disk. */
    async save(rules: ConfiguredStorageRule[], hash: string): Promise<RulesView> {
      const state = await readConfigFile(configPath);
      if (!state.path || !state.writable) throw new ConfigNotWritableError(state.path);
      if (state.hash !== hash) throw new ConfigChangedError();
      const next = render(state, rules);
      await writeConfigFile(state.path, next.text, hash);
      runtime.rules.apply(next.config.storage.rules);
      console.log(`[rules] Wrote ${next.config.storage.rules.length} storage rule(s) to ${state.path} and applied them`);
      return await view();
    },

    /** Re-read config.yml and apply its storage.rules (e.g. after a hand edit). Other settings still need a restart. */
    async reload(): Promise<RulesView> {
      const state = await readConfigFile(configPath);
      if (!state.exists) throw new InvalidConfigError([{ path: "(file)", message: "No config file to reload" }]);
      const parsed = parseConfigText(state.text, { quiet: true });
      runtime.rules.apply(parsed.storage.rules);
      console.log(`[rules] Reloaded ${parsed.storage.rules.length} storage rule(s) from ${state.path}`);
      return await view(state);
    },

    /** Evaluate upload probes and (optionally) a prune sample against proposed or saved rules. */
    async preview(body: z.output<typeof RulePreviewBodySchema>): Promise<RulePreviewResult> {
      const entries = body.rules ?? runtime.rules.entries();
      const active = runtime.rules.resolve(entries);
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
