import { z } from "zod";
import type { ReportDto } from "./blobs.ts";

export const UserKeySchema = z.string().toLowerCase().regex(/^([0-9a-f]{64}|anonymous)$/);
export const UserPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const UsersQuerySchema = UserPageQuerySchema.extend({
  q: z.string().trim().toLowerCase().max(256).default(""),
  role: z.enum(["all", "owners", "reporters"]).default("all"),
  sort: z.enum(["pubkey", "blobCount", "totalSize", "reportCount", "lastUpload"]).default("totalSize"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
export const UserReportsQuerySchema = UserPageQuerySchema.extend({ scope: z.enum(["filed", "received"]).default("filed") });
export type UsersQuery = z.infer<typeof UsersQuerySchema>;
export type UserPageQuery = z.infer<typeof UserPageQuerySchema>;
export type UserReportsQuery = z.infer<typeof UserReportsQuerySchema>;
export interface UserSummary {
  pubkey: string;
  blobCount: number;
  totalSize: number;
  sharedBlobCount: number;
  reportCount: number;
  receivedReportCount: number;
  firstUpload: number | null;
  lastUpload: number | null;
  firstReport: number | null;
  lastReport: number | null;
}
export interface UserBlob {
  sha256: string;
  type: string | null;
  size: number;
  uploaded: number | null;
  ownerCount: number;
}
export interface UserPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export type UsersPage = UserPage<UserSummary>;
export type UserBlobsPage = UserPage<UserBlob>;
export type UserReportsPage = UserPage<ReportDto>;
