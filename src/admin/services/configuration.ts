import type { Config } from "../../config/schema.ts";
import type { ServerRuntime } from "../../runtime.ts";
import type { ConfigurationSummary } from "../contracts/configuration.ts";

export function createConfigurationService(config: Config, runtime: ServerRuntime) {
  return {
    summary(): ConfigurationSummary {
      return {
        managementMode: "deployment-managed",
        source: "startup-configuration",
        editable: false,
        applyMode: "restart",
        settings: {
          storageBackend: config.storage.backend,
          storageRuleCount: runtime.rules.current().length,
          uploadEnabled: config.upload.enabled,
          uploadMaxSize: config.upload.maxSize,
          uploadRequireAuth: config.upload.requireAuth,
        },
      };
    },
  };
}
