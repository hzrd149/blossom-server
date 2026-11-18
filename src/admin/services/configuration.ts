import type { Config } from "../../config/schema.ts";
import { readConfigFile } from "../../config/editor.ts";
import type { ServerRuntime } from "../../runtime.ts";
import type { ConfigurationSummary } from "../contracts/configuration.ts";

export function createConfigurationService(config: Config, runtime: ServerRuntime, configPath?: string) {
  return {
    async summary(): Promise<ConfigurationSummary> {
      const file = await readConfigFile(configPath);
      return {
        managementMode: "deployment-managed",
        source: "startup-configuration",
        editable: false,
        applyMode: "restart",
        configFile: { path: file.path, exists: file.exists, writable: file.writable },
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
