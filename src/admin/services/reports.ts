import type { ContentService } from "./content.ts";
import type { ManagementDatabase } from "./database.ts";

export function createReportService(db: ManagementDatabase, content: ContentService) {
  return {
    list: db.listAdminReports,
    dismiss: (id: number) => db.deleteReport(id),
    async deleteContent(id: number): Promise<boolean> {
      const report = await db.getReport(id);
      if (!report) return false;
      await content.forceDelete(report.blob);
      await db.deleteReportsByBlob(report.blob);
      return true;
    },
  };
}
