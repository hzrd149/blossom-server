import { queryOptions } from "@tanstack/react-query";
import { adminApi } from "./client.ts";

/** Shared prefixes allow future mutations to invalidate related cached reads. */
export const adminQueryKeys = {
  all: ["admin"] as const,
  summary: ["admin", "summary"] as const,
  configuration: ["admin", "configuration"] as const,
  content: ["admin", "content"] as const,
};

/** Use with useQuery, prefetchQuery, or ensureQueryData. */
export const adminQueries = {
  summary: () =>
    queryOptions({
      queryKey: adminQueryKeys.summary,
      queryFn: ({ signal }) => adminApi.summary(signal),
    }),
  configuration: () =>
    queryOptions({
      queryKey: adminQueryKeys.configuration,
      queryFn: ({ signal }) => adminApi.configuration(signal),
    }),
  content: (page = 1, q = "") =>
    queryOptions({
      queryKey: [...adminQueryKeys.content, { page, q: q.trim() }],
      queryFn: ({ signal }) => adminApi.content(page, q.trim(), signal),
    }),
};
