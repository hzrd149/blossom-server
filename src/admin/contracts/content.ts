import { z } from "zod";

export const CONTENT_SORT_COLUMNS = ["uploaded", "size", "type", "sha256"] as const;

export const ContentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /** Substring of the hash or MIME type. */
  q: z.string().trim().max(256).default(""),
  /** Only blobs owned by this pubkey (hex) or the "anonymous" pseudo-owner. */
  owner: z.string().trim().toLowerCase().regex(/^([0-9a-f]{64}|anonymous)$/).optional(),
  sort: z.enum(CONTENT_SORT_COLUMNS).default("uploaded"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export type ContentQuery = z.infer<typeof ContentQuerySchema>;

export interface ContentItem {
  sha256: string;
  size: number;
  type: string | null;
  uploaded: number;
  owners: string[];
  /** Same-origin path that serves the blob, e.g. "/<sha256>.png". */
  path: string;
}

export interface ContentPage {
  items: ContentItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventorySummary {
  blobCount: number;
  totalSize: number;
  /** Blobs first uploaded in the last 24 hours. */
  dailyUploads: number;
  userCount: number;
  reportCount: number;
  reportedBlobCount: number;
}
