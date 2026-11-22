/**
 * Moderation admin API contracts (docs/moderation/local-bans.md). Browser-safe: zod and the
 * pure moderation schema only.
 */

import { z } from "zod";
import { BAN_CATEGORIES, type BanCategory, BanCategorySchema, HEX64_RE, PubkeyInputSchema } from "../../policy/moderation-schema.ts";

export { BAN_CATEGORIES };
export type { BanCategory };

/** True when `value` is a ban category. */
export function isBanCategory(value: unknown): value is BanCategory {
  return typeof value === "string" && (BAN_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Extract a SHA-256 from a bare hash or a blob URL (e.g. https://cdn.example.com/<sha256>.png).
 * Returns null when no hash can be found.
 */
export function parseBlobRef(value: string): string | null {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (HEX64_RE.test(lower)) return lower;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const matches = url.pathname.toLowerCase().match(/[0-9a-f]{64}/g);
    return matches ? matches[matches.length - 1] : null;
  } catch {
    return null;
  }
}

/** A SHA-256 or a blob URL, normalized to the lowercase hash. */
export const BlobRefSchema = z.string().transform((value, ctx) => {
  const hash = parseBlobRef(value);
  if (!hash) {
    ctx.addIssue({ code: "custom", message: "Expected a 64-character SHA-256 or a blob URL" });
    return z.NEVER;
  }
  return hash;
});

const NoteSchema = z.string().trim().max(1000).nullish().transform((value) => value || null);

export const ModerationPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().toLowerCase().max(256).default(""),
});
export type ModerationPageQuery = z.infer<typeof ModerationPageQuerySchema>;

export const BannedBlobsQuerySchema = ModerationPageQuerySchema.extend({
  category: z.enum(["all", ...BAN_CATEGORIES]).default("all"),
});
export type BannedBlobsQuery = z.infer<typeof BannedBlobsQuerySchema>;

export const BanPubkeyBodySchema = z.object({
  /** Hex or npub. */
  pubkey: PubkeyInputSchema,
  reason: BanCategorySchema.nullish().transform((value) => value ?? null),
  note: NoteSchema,
  /** "keep" leaves blobs untouched; "remove" drops the pubkey's ownership and deletes blobs left without owners. */
  content: z.enum(["keep", "remove"]).default("keep"),
});
export type BanPubkeyBody = z.input<typeof BanPubkeyBodySchema>;

export const BanBlobBodySchema = z.object({
  /** SHA-256 or a blob URL. */
  sha256: BlobRefSchema,
  category: BanCategorySchema,
  note: NoteSchema,
});
export type BanBlobBody = z.input<typeof BanBlobBodySchema>;

/** Optional body of POST /reports/:id/ban-blob. Category defaults to the report type when it is a ban category, else "other". */
export const ReportBanBodySchema = z.object({
  category: BanCategorySchema.optional(),
  note: NoteSchema,
});
export type ReportBanBody = z.input<typeof ReportBanBodySchema>;

export interface ModerationPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BannedPubkeyDto {
  pubkey: string;
  reason: string | null;
  note: string | null;
  created: number;
}

export interface BannedBlobDto {
  sha256: string;
  category: string;
  note: string | null;
  created: number;
}

export interface BanPubkeyResultDto {
  pubkey: string;
  removedOwnership: number;
  deleted: string[];
}

export interface BanBlobResultDto {
  banned: string[];
  deleted: string[];
  reportsResolved: number;
}

export interface PubkeyBanStatus {
  pubkey: string;
  ban: BannedPubkeyDto | null;
}

/** Moderation state of a hash, for the blob page. */
export interface BlobModerationStatus {
  sha256: string;
  stored: boolean;
  /** Local blob ban. */
  ban: BannedBlobDto | null;
}
