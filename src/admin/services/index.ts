import type { Client } from "@libsql/client";
import type { Config } from "../../config/schema.ts";
import type { IBlobStorage } from "../../storage/interface.ts";
import { createManagementDatabase } from "./database.ts";
import { createContentService } from "./content.ts";
import { createUserService } from "./users.ts";
import { createReportService } from "./reports.ts";
import { createConfigurationService } from "./configuration.ts";

export function createManagementServices(db: Client, storage: IBlobStorage, config: Config) {
  const database = createManagementDatabase(db);
  const content = createContentService(database, storage);
  return {
    content,
    users: createUserService(database, content),
    reports: createReportService(database, content),
    configuration: createConfigurationService(config),
  };
}

export type ManagementServices = ReturnType<typeof createManagementServices>;
