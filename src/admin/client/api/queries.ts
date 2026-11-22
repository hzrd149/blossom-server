import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { ReportsQuery } from "../../contracts/reports.ts";
import type { ContentQuery } from "../../contracts/content.ts";
import type {
  UserPageQuery,
  UserReportsQuery,
  UsersQuery,
} from "../../contracts/users.ts";
import type {
  BannedBlobsQuery,
  ModerationPageQuery,
} from "../../contracts/moderation.ts";
import { adminApi } from "./client.ts";

/** Shared prefixes let mutations invalidate related cached reads. */
export const adminQueryKeys = {
  reports: ["admin", "reports"] as const,
  all: ["admin"] as const,
  users: ["admin", "users"] as const,
  summary: ["admin", "summary"] as const,
  configuration: ["admin", "configuration"] as const,
  content: ["admin", "content"] as const,
  blobs: ["admin", "blobs"] as const,
  rules: ["admin", "rules"] as const,
  prune: ["admin", "prune"] as const,
  moderation: ["admin", "moderation"] as const,
};

/** Use with useQuery, prefetchQuery, or ensureQueryData. */
export const adminQueries = {
  reports: (params: Partial<ReportsQuery>) =>
    queryOptions({
      queryKey: [...adminQueryKeys.reports, params],
      queryFn: ({ signal }) => adminApi.reports(params, signal),
    }),
  users: (params: Partial<UsersQuery>) =>
    queryOptions({
      queryKey: [...adminQueryKeys.users, "list", params],
      queryFn: ({ signal }) => adminApi.users(params, signal),
    }),
  user: (pubkey: string) =>
    queryOptions({
      queryKey: [...adminQueryKeys.users, pubkey],
      queryFn: ({ signal }) => adminApi.user(pubkey, signal),
    }),
  userBlobs: (pubkey: string, params: Partial<UserPageQuery>) =>
    queryOptions({
      queryKey: [...adminQueryKeys.users, pubkey, "blobs", params],
      queryFn: ({ signal }) => adminApi.userBlobs(pubkey, params, signal),
    }),
  userReports: (pubkey: string, params: Partial<UserReportsQuery>) =>
    queryOptions({
      queryKey: [...adminQueryKeys.users, pubkey, "reports", params],
      queryFn: ({ signal }) => adminApi.userReports(pubkey, params, signal),
    }),
  summary: () =>
    queryOptions({
      queryKey: adminQueryKeys.summary,
      queryFn: ({ signal }) => adminApi.summary(signal),
      refetchInterval: 30_000,
    }),
  configuration: () =>
    queryOptions({
      queryKey: adminQueryKeys.configuration,
      queryFn: ({ signal }) => adminApi.configuration(signal),
    }),
  content: (params: Partial<ContentQuery>) =>
    queryOptions({
      queryKey: [...adminQueryKeys.content, params],
      queryFn: ({ signal }) => adminApi.content(params, signal),
      placeholderData: keepPreviousData,
    }),
  blob: (sha256: string) =>
    queryOptions({
      queryKey: [...adminQueryKeys.blobs, sha256],
      queryFn: ({ signal }) => adminApi.blob(sha256, signal),
    }),
  rules: () =>
    queryOptions({
      queryKey: adminQueryKeys.rules,
      queryFn: ({ signal }) => adminApi.rules(signal),
    }),
  pruneStatus: () =>
    queryOptions({
      queryKey: adminQueryKeys.prune,
      queryFn: ({ signal }) => adminApi.pruneStatus(signal),
      refetchInterval: (query) => query.state.data?.running ? 2_000 : 30_000,
    }),
  bannedPubkeys: (params: Partial<ModerationPageQuery>) =>
    queryOptions({
      queryKey: [...adminQueryKeys.moderation, "pubkeys", params],
      queryFn: ({ signal }) => adminApi.bannedPubkeys(params, signal),
      placeholderData: keepPreviousData,
    }),
  pubkeyBan: (pubkey: string) =>
    queryOptions({
      queryKey: [...adminQueryKeys.moderation, "pubkey", pubkey],
      queryFn: ({ signal }) => adminApi.pubkeyBan(pubkey, signal),
    }),
  bannedBlobs: (params: Partial<BannedBlobsQuery>) =>
    queryOptions({
      queryKey: [...adminQueryKeys.moderation, "blobs", params],
      queryFn: ({ signal }) => adminApi.bannedBlobs(params, signal),
      placeholderData: keepPreviousData,
    }),
  blobModeration: (sha256: string) =>
    queryOptions({
      queryKey: [...adminQueryKeys.moderation, "blob", sha256],
      queryFn: ({ signal }) => adminApi.blobModeration(sha256, signal),
    }),
};
