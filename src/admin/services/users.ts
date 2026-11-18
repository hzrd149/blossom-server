import { type ContentService, toReportDto } from "./content.ts";
import type { UserReportsQuery } from "../contracts/users.ts";
import type { ManagementDatabase } from "./database.ts";

export function createUserService(db: ManagementDatabase, content: ContentService) {
  return {
    list: db.listUsers,
    detail: db.getUser,
    blobs: db.listUserBlobs,
    async reports(pubkey: string, query: UserReportsQuery) {
      const result = await db.listUserReports(pubkey, query);
      return { ...result, items: result.items.map(toReportDto) };
    },
    /** Legacy action: force-deletes shared blobs too; capped at the original 10,000 records. */
    async deleteContent(pubkey: string): Promise<number> {
      const blobs = await db.listBlobsByPubkeyAdmin(pubkey, { limit: 10_000 });
      for (const blob of blobs) await content.forceDelete(blob.sha256);
      return blobs.length;
    },
  };
}
