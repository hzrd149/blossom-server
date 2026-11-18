import { QueryClient } from "@tanstack/react-query";
import { AdminApiError } from "./client.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (
          error instanceof AdminApiError && error.status >= 400 &&
          error.status < 500
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
