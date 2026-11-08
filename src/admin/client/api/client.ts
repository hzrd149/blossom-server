import type { ContentPage, InventorySummary } from "../../contracts/content.ts";
import type { ConfigurationSummary } from "../../contracts/configuration.ts";

export class AdminApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/admin/api/${path}`, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === "object" && "error" in body &&
        typeof body.error === "string"
      ? body.error
      : `Request failed (${response.status})`;
    throw new AdminApiError(response.status, message);
  }
  return response.json();
}

export const adminApi = {
  summary: (signal: AbortSignal) => get<InventorySummary>("summary", signal),
  configuration: (signal: AbortSignal) =>
    get<ConfigurationSummary>("configuration", signal),
  content: (page: number, q: string, signal: AbortSignal) =>
    get<ContentPage>(
      `content?${new URLSearchParams({
        page: String(page),
        pageSize: "25",
        q,
      })}`,
      signal,
    ),
};
