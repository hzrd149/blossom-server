/** Explicitly allowlisted view; never send the runtime Config object to a browser. */
export interface ConfigurationSummary {
  managementMode: "deployment-managed";
  source: "startup-configuration";
  editable: false;
  applyMode: "restart";
  settings: {
    storageBackend: "local" | "s3";
    storageRuleCount: number;
    uploadEnabled: boolean;
    uploadMaxSize: number;
    uploadRequireAuth: boolean;
  };
}
