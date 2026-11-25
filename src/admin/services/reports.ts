import type { ReportsPage, ReportsQuery } from "../contracts/reports.ts";
import { blobPath, type ContentService } from "./content.ts";
import type { ManagementDatabase } from "./database.ts";

export function createReportService(db: ManagementDatabase, content: ContentService) {
  return {
    async list(query: ReportsQuery): Promise<ReportsPage> {
      const page = await db.listAdminReports(query);
      return { ...page, items: page.items.map((item) => ({ ...item, path: blobPath(item.blob, item.blobType) })) };
    },
    dismiss: (id: number) => db.dismissReport(id),
    cleanup: db.cleanupReports,
    async deleteContent(id: number): Promise<boolean> {
      const report = await db.getReport(id);
      if (!report) return false;
      await content.forceDelete(report.blob);
      return true;
    },
  };
}
