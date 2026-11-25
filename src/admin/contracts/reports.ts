import { z } from "zod";
import type { ReportDto } from "./blobs.ts";

export const REPORT_FILTER_TYPES = [
  "nudity",
  "malware",
  "profanity",
  "illegal",
  "spam",
  "impersonation",
  "other",
] as const;
export const ReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(256).default(""),
  reporter: z.string().trim().toLowerCase().regex(/^([0-9a-f]{64}|anonymous)$/)
    .optional(),
  owner: z.string().trim().toLowerCase().regex(/^([0-9a-f]{64}|anonymous)$/)
    .optional(),
  type: z.enum(["all", "unspecified", ...REPORT_FILTER_TYPES]).default("all"),
  status: z.enum(["all", "active", "dismissed"]).default("all"),
  availability: z.enum(["all", "stored", "missing"]).default("all"),
  sort: z.enum(["created", "type", "reporter", "blob"]).default("created"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
export type ReportsQuery = z.infer<typeof ReportsQuerySchema>;
export const ReportCleanupSchema = z.object({
  target: z.enum(["missing", "dismissed"]),
});
export type ReportCleanupTarget = z.infer<typeof ReportCleanupSchema>["target"];
export interface ReportItem extends ReportDto {
  blobType: string | null;
  blobSize: number | null;
  ownerCount: number;
  /** All retained reports on this blob, including this one. */
  blobReportCount: number;
  /** Same-origin path that serves the blob, e.g. "/<sha256>.png". */
  path: string;
}
export interface ReportsPage {
  items: ReportItem[];
  total: number;
  blobCount: number;
  reporterCount: number;
  page: number;
  pageSize: number;
}
