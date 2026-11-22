import type { BlobDetail } from "../../contracts/blobs.ts";
import type { ReportsPage, ReportsQuery } from "../../contracts/reports.ts";
import type {
  UserBlobsPage,
  UserPageQuery,
  UserReportsPage,
  UserReportsQuery,
  UsersPage,
  UsersQuery,
  UserSummary,
} from "../../contracts/users.ts";
import type {
  ContentPage,
  ContentQuery,
  InventorySummary,
} from "../../contracts/content.ts";
import type { ConfigurationSummary } from "../../contracts/configuration.ts";
import type { AdminApiError as AdminApiErrorBody } from "../../contracts/errors.ts";
import type {
  PruneStatusDto,
  RenderedConfig,
  RenderRulesBody,
  RulesView,
  SaveRulesBody,
} from "../../contracts/rules.ts";

import type {
  BanBlobBody,
  BanBlobResultDto,
  BannedBlobDto,
  BannedBlobsQuery,
  BannedPubkeyDto,
  BanPubkeyBody,
  BanPubkeyResultDto,
  BlobModerationStatus,
  ModerationPage,
  ModerationPageQuery,
  PubkeyBanStatus,
  ReportBanBody,
} from "../../contracts/moderation.ts";

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: NonNullable<AdminApiErrorBody["issues"]> = [],
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // Resolve against location.origin: a page opened as http://user:pass@host/admin would
  // otherwise resolve relative URLs to credentialed URLs, which fetch() rejects.
  const response = await fetch(new URL(`/admin/api/${path}`, location.origin), {
    method,
    credentials: "same-origin",
    signal,
    headers: body === undefined
      ? undefined
      : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as
      | Partial<AdminApiErrorBody>
      | null;
    throw new AdminApiError(
      response.status,
      typeof error?.error === "string"
        ? error.error
        : `Request failed (${response.status})`,
      error?.issues ?? [],
    );
  }
  return response.json();
}

const get = <T>(path: string, signal: AbortSignal) =>
  request<T>("GET", path, undefined, signal);

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const adminApi = {
  reports: (params: Partial<ReportsQuery>, signal: AbortSignal) =>
    get<ReportsPage>(`reports${query(params)}`, signal),
  users: (params: Partial<UsersQuery>, signal: AbortSignal) =>
    get<UsersPage>(`users${query(params)}`, signal),
  user: (pubkey: string, signal: AbortSignal) =>
    get<UserSummary>(`users/${pubkey}`, signal),
  userBlobs: (
    pubkey: string,
    params: Partial<UserPageQuery>,
    signal: AbortSignal,
  ) => get<UserBlobsPage>(`users/${pubkey}/blobs${query(params)}`, signal),
  userReports: (
    pubkey: string,
    params: Partial<UserReportsQuery>,
    signal: AbortSignal,
  ) => get<UserReportsPage>(`users/${pubkey}/reports${query(params)}`, signal),
  summary: (signal: AbortSignal) => get<InventorySummary>("summary", signal),
  configuration: (signal: AbortSignal) =>
    get<ConfigurationSummary>("configuration", signal),
  content: (params: Partial<ContentQuery>, signal: AbortSignal) =>
    get<ContentPage>(`content${query(params)}`, signal),
  blob: (sha256: string, signal: AbortSignal) =>
    get<BlobDetail>(`blobs/${sha256}`, signal),
  deleteBlob: (sha256: string) =>
    request<{ success: true }>("DELETE", `blobs/${sha256}`),
  deleteUserContent: (pubkey: string) =>
    request<{ success: true; deleted: number }>("DELETE", `users/${pubkey}`),
  reportAction: (id: number, action: "dismiss" | "delete-blob") =>
    request<{ success: true }>("POST", `reports/${id}/${action}`),
  banReportedBlob: (id: number, body: ReportBanBody = {}) =>
    request<BanBlobResultDto & { success: true }>(
      "POST",
      `reports/${id}/ban-blob`,
      body,
    ),

  bannedPubkeys: (params: Partial<ModerationPageQuery>, signal: AbortSignal) =>
    get<ModerationPage<BannedPubkeyDto>>(
      `bans/pubkeys${query(params)}`,
      signal,
    ),
  pubkeyBan: (pubkey: string, signal: AbortSignal) =>
    get<PubkeyBanStatus>(`bans/pubkeys/${pubkey}`, signal),
  banPubkey: (body: BanPubkeyBody) =>
    request<BanPubkeyResultDto>("POST", "bans/pubkeys", body),
  unbanPubkey: (pubkey: string) =>
    request<{ success: true }>("DELETE", `bans/pubkeys/${pubkey}`),
  bannedBlobs: (params: Partial<BannedBlobsQuery>, signal: AbortSignal) =>
    get<ModerationPage<BannedBlobDto>>(`bans/blobs${query(params)}`, signal),
  banBlob: (body: BanBlobBody) =>
    request<BanBlobResultDto>("POST", "bans/blobs", body),
  unbanBlob: (sha256: string) =>
    request<{ success: true }>("DELETE", `bans/blobs/${sha256}`),
  blobModeration: (sha256: string, signal: AbortSignal) =>
    get<BlobModerationStatus>(`moderation/blobs/${sha256}`, signal),

  rules: (signal: AbortSignal) => get<RulesView>("rules", signal),
  saveRules: (body: SaveRulesBody) => request<RulesView>("PUT", "rules", body),
  renderRules: (body: RenderRulesBody) =>
    request<RenderedConfig>("POST", "rules/render", body),
  reloadRules: () => request<RulesView>("POST", "rules/reload"),
  pruneStatus: (signal: AbortSignal) =>
    get<PruneStatusDto>("prune/status", signal),
};
