/** Explicitly allowlisted view; never send the runtime Config object to a browser. */
export interface ConfigurationSummary {
  managementMode: "deployment-managed";
  source: "startup-configuration";
  editable: false;
  /** Settings apply on restart; storage rules saved from the console apply immediately. */
  applyMode: "restart";
  /** Whether the console can write storage rules back to the config file. */
  configFile: { path: string | null; exists: boolean; writable: boolean };
  settings: {
    storageBackend: "local" | "s3";
    storageRuleCount: number;
    uploadEnabled: boolean;
    uploadMaxSize: number;
    uploadRequireAuth: boolean;
  };
}
