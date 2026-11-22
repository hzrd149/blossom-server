import type { Client } from "@libsql/client";
import type { Config } from "../../config/schema.ts";
import type { IBlobStorage } from "../../storage/interface.ts";
import type { ServerRuntime } from "../../runtime.ts";
import { createManagementDatabase } from "./database.ts";
import { createContentService } from "./content.ts";
import { createUserService } from "./users.ts";
import { createReportService } from "./reports.ts";
import { createConfigurationService } from "./configuration.ts";
import { createPruneService, createRuleService } from "./rules.ts";
import { createModerationService } from "./moderation.ts";

export function createManagementServices(
  db: Client,
  storage: IBlobStorage,
  config: Config,
  runtime: ServerRuntime,
  configPath?: string,
) {
  const database = createManagementDatabase(db);
  const content = createContentService(database, storage, runtime);
  return {
    content,
    users: createUserService(database, content, runtime),
    reports: createReportService(database, content),
    configuration: createConfigurationService(config, runtime, configPath),
    rules: createRuleService(config, runtime, configPath),
    prune: createPruneService(config, runtime),
    moderation: createModerationService(database, runtime),
  };
}

export type ManagementServices = ReturnType<typeof createManagementServices>;
