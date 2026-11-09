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

export function createManagementServices(db: Client, storage: IBlobStorage, config: Config, runtime: ServerRuntime) {
  const database = createManagementDatabase(db);
  const content = createContentService(database, storage, runtime);
  return {
    content,
    users: createUserService(database, content),
    reports: createReportService(database, content),
    configuration: createConfigurationService(config, runtime),
    rules: createRuleService(config, runtime),
    prune: createPruneService(config, runtime),
  };
}

export type ManagementServices = ReturnType<typeof createManagementServices>;
