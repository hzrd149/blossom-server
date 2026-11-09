import { z } from "zod";
import type { ReportDto } from "./blobs.ts";

export const REPORT_FILTER_TYPES = ["nudity", "malware", "profanity", "illegal", "spam", "impersonation", "other"] as const;
export const ReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(256).default(""),
  type: z.enum(["all", "unspecified", ...REPORT_FILTER_TYPES]).default("all"),
  sort: z.enum(["created", "type", "reporter", "blob"]).default("created"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
export type ReportsQuery = z.infer<typeof ReportsQuerySchema>;
export interface ReportItem extends ReportDto {
  blobType: string | null;
  blobSize: number | null;
  ownerCount: number;
}
export interface ReportsPage {
  items: ReportItem[];
  total: number;
  blobCount: number;
  reporterCount: number;
  page: number;
  pageSize: number;
}
