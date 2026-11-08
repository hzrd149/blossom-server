import { z } from "zod";

export const ContentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(256).default(""),
});

export type ContentQuery = z.infer<typeof ContentQuerySchema>;

export interface ContentItem {
  sha256: string;
  size: number;
  type: string | null;
  uploaded: number;
  owners: string[];
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
  dailyUploads: number;
}
