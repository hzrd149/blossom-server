import type { StorageRule } from "../../policy/rule-schema.ts";

export interface ReportDto {
  id: number;
  eventId: string;
  reporter: string;
  blob: string;
  type: string | null;
  content: string;
  created: number;
  dismissed: boolean;
}

export interface BlobRetention {
  /** Index into the managed rule list (GET /rules), or null when no rule governs the blob. */
  ruleIndex: number | null;
  rule: StorageRule | null;
  basis: "accessed" | "uploaded" | null;
  /** Unix time when the blob becomes eligible for pruning, or null if never by rule. */
  expiresAt: number | null;
}

export interface BlobDetail {
  sha256: string;
  size: number;
  type: string | null;
  uploaded: number;
  /** NIP-94 tags persisted for this blob. */
  nip94: string[][] | null;
  /** Same-origin path that serves the blob, e.g. "/<sha256>.png". */
  path: string;
  owners: { pubkey: string; uploaded: number | null }[];
  accessed: number | null;
  derivedFrom: string[];
  thumbnail: string | null;
  thumbnailOf: string | null;
  reports: ReportDto[];
  retention: BlobRetention;
}
