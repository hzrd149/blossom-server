import type { IBlobStorage } from "../../storage/interface.ts";
import { mimeToExt } from "../../utils/mime.ts";
import type { ContentPage, ContentQuery, InventorySummary } from "../contracts/content.ts";
import type { ManagementDatabase } from "./database.ts";

export function createContentService(db: ManagementDatabase, storage: IBlobStorage) {
  return {
    async list(query: ContentQuery): Promise<ContentPage> {
      const filter = query.q ? { q: query.q } : undefined;
      const [rows, total] = await Promise.all([
        db.listAllBlobs({ filter, limit: query.pageSize, offset: (query.page - 1) * query.pageSize, sort: ["uploaded", "DESC"] }),
        db.countBlobs(filter),
      ]);
      return {
        items: rows.map(({ sha256, size, type, uploaded, owners }) => ({ sha256, size, type, uploaded, owners })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
    async summary(): Promise<InventorySummary> {
      const { blobCount, totalSize, dailyUploads } = await db.getStats();
      return { blobCount, totalSize, dailyUploads };
    },
    /** Preserve existing force-delete semantics: removes the blob for every owner. */
    async forceDelete(hash: string): Promise<void> {
      const blob = await db.getBlob(hash);
      await db.deleteBlob(hash);
      await storage.remove(hash, blob ? mimeToExt(blob.type) : "").catch((err) => {
        console.warn(`[admin] Failed to remove blob ${hash} from storage:`, err);
      });
    },
  };
}

export type ContentService = ReturnType<typeof createContentService>;
