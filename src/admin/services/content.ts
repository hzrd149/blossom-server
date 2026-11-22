import type { IBlobStorage } from "../../storage/interface.ts";
import { mimeToExt } from "../../utils/mime.ts";
import { computeExpiry, getGoverningRuleIndex } from "../../prune/rules.ts";
import type { ReportRecord } from "../../db/reports.ts";
import type { ServerRuntime } from "../../runtime.ts";
import type { BlobDetail, ReportDto } from "../contracts/blobs.ts";
import type { ContentPage, ContentQuery, InventorySummary } from "../contracts/content.ts";
import type { ManagementDatabase } from "./database.ts";

export function blobPath(sha256: string, type: string | null): string {
  const ext = mimeToExt(type);
  return `/${sha256}${ext ? `.${ext}` : ""}`;
}

export function toReportDto(report: ReportRecord): ReportDto {
  return {
    id: report.id,
    eventId: report.event_id,
    reporter: report.reporter,
    blob: report.blob,
    type: report.type,
    content: report.content,
    created: report.created,
  };
}

export function createContentService(db: ManagementDatabase, storage: IBlobStorage, runtime: ServerRuntime) {
  return {
    async list(query: ContentQuery): Promise<ContentPage> {
      const filter = query.q || query.owner ? { q: query.q || undefined, owner: query.owner } : undefined;
      const [rows, total] = await Promise.all([
        db.listAllBlobs({
          filter,
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
          sort: [query.sort, query.dir === "asc" ? "ASC" : "DESC"],
        }),
        db.countBlobs(filter),
      ]);
      return {
        items: rows.map(({ sha256, size, type, uploaded, owners }) => ({ sha256, size, type, uploaded, owners, path: blobPath(sha256, type) })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
    async summary(): Promise<InventorySummary> {
      const [{ blobCount, totalSize, dailyUploads }, counts] = await Promise.all([db.getStats(), db.getAdminCounts()]);
      return { blobCount, totalSize, dailyUploads, ...counts };
    },
    async detail(hash: string): Promise<BlobDetail | null> {
      const blob = await db.getBlob(hash);
      if (!blob) return null;
      const [relations, reports] = await Promise.all([
        db.getBlobRelations(hash),
        db.listReports({ filter: { blob: hash }, limit: 200 }),
      ]);
      // Retention: first-match over active rules, reported as an index into the managed list.
      const active = runtime.rules.current();
      const activeIndex = relations.thumbnailOf
        ? -1 // Thumbnails follow their parent and are never pruned by rule directly.
        : getGoverningRuleIndex({ type: blob.type, owners: relations.owners.map((o) => o.pubkey) }, active);
      const rule = activeIndex === -1 ? null : active[activeIndex];
      const entryIndexes = runtime.rules.entries().flatMap((entry, index) => entry.enabled === false ? [] : [index]);
      return {
        sha256: blob.sha256,
        size: blob.size,
        type: blob.type,
        uploaded: blob.uploaded,
        nip94: blob.nip94,
        path: blobPath(blob.sha256, blob.type),
        ...relations,
        reports: reports.map(toReportDto),
        retention: {
          ruleIndex: rule ? entryIndexes[activeIndex] : null,
          rule,
          basis: rule ? (rule.basis === "uploaded" || relations.accessed === null ? "uploaded" : "accessed") : null,
          expiresAt: rule ? computeExpiry({ uploaded: blob.uploaded, accessed: relations.accessed }, rule) : null,
        },
      };
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
