import { type ContentService, toReportDto } from "./content.ts";
import type { UserReportsQuery, UsersPage, UserSummary } from "../contracts/users.ts";
import type { ManagementDatabase } from "./database.ts";
import type { ServerRuntime } from "../../runtime.ts";

export function createUserService(db: ManagementDatabase, content: ContentService, runtime: ServerRuntime) {
  const banned = (pubkey: string) => runtime.moderation.isPubkeyBanned(pubkey);
  return {
    async list(query: Parameters<ManagementDatabase["listUsers"]>[0]): Promise<UsersPage> {
      const page = await db.listUsers(query);
      return { ...page, items: page.items.map((user) => ({ ...user, banned: banned(user.pubkey) })) };
    },
    async detail(pubkey: string): Promise<UserSummary | null> {
      const user = await db.getUser(pubkey);
      return user ? { ...user, banned: banned(pubkey) } : null;
    },
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
