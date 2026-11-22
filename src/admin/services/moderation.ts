import type { BanCategory } from "../../policy/moderation-schema.ts";
import {
  type BanBlobResultDto,
  type BannedBlobDto,
  type BannedBlobsQuery,
  type BannedPubkeyDto,
  type BanPubkeyResultDto,
  type BlobModerationStatus,
  isBanCategory,
  type ModerationPage,
  type ModerationPageQuery,
  type PubkeyBanStatus,
} from "../contracts/moderation.ts";
import type { ServerRuntime } from "../../runtime.ts";
import { normalizePubkey } from "../../policy/moderation-schema.ts";
import type { ManagementDatabase } from "./database.ts";

/**
 * Local pubkey and blob bans over runtime.moderation. Inputs are validated by the API
 * contracts; the moderation service re-validates and throws ModerationInputError (→ 400).
 */
export function createModerationService(db: ManagementDatabase, runtime: ServerRuntime) {
  const moderation = runtime.moderation;

  return {
    /** A `q` that is a full npub or hex pubkey searches by its hex form. */
    listBannedPubkeys: (query: ModerationPageQuery): Promise<ModerationPage<BannedPubkeyDto>> =>
      moderation.listBannedPubkeys({ ...query, q: (query.q && normalizePubkey(query.q)) || query.q }),
    async banPubkey(input: { pubkey: string; reason: BanCategory | null; note: string | null; content: "keep" | "remove" }): Promise<BanPubkeyResultDto> {
      return await moderation.banPubkey(input);
    },
    unbanPubkey: (pubkey: string): Promise<boolean> => moderation.unbanPubkey(pubkey),
    async pubkeyStatus(pubkey: string): Promise<PubkeyBanStatus> {
      return { pubkey, ban: await moderation.getBannedPubkey(pubkey) };
    },
    isPubkeyBanned: (pubkey: string): boolean => moderation.isPubkeyBanned(pubkey),

    listBannedBlobs: (query: BannedBlobsQuery): Promise<ModerationPage<BannedBlobDto>> =>
      moderation.listBannedBlobs({ ...query, category: query.category === "all" ? undefined : query.category }),
    async banBlob(input: { sha256: string; category: BanCategory; note: string | null }): Promise<BanBlobResultDto> {
      return await moderation.banBlob(input);
    },
    unbanBlob: (sha256: string): Promise<boolean> => moderation.unbanBlob(sha256),

    /** Ban the blob of a report. Category: explicit, else the report type when it is a ban category, else "other". */
    async banReportedBlob(id: number, input: { category?: BanCategory; note: string | null }): Promise<BanBlobResultDto | null> {
      const report = await db.getReport(id);
      if (!report) return null;
      const category = input.category ?? (isBanCategory(report.type) ? report.type : "other");
      return await moderation.banBlob({ sha256: report.blob, category, note: input.note });
    },

    async blobStatus(sha256: string): Promise<BlobModerationStatus> {
      const [blob, ban] = await Promise.all([db.getBlob(sha256), moderation.getBannedBlob(sha256)]);
      return { sha256, stored: blob !== null, ban };
    },
  };
}
