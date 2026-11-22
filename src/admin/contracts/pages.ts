/**
 * Client-side console pages under /admin. Shared by the React router and the
 * server, which serves the HTML shell only for these paths (anything else is 404).
 * Patterns use ":param" segments; params match one path segment.
 */
export const ADMIN_PAGES = {
  dashboard: "/",
  content: "/content",
  users: "/users",
  reports: "/reports",
  user: "/users/:pubkey",
  blob: "/blobs/:sha256",
  rules: "/rules",
  moderation: "/moderation",
  settings: "/settings",
} as const;

export type AdminPage = keyof typeof ADMIN_PAGES;

/** Match a path (relative to /admin, e.g. "/blobs/abc") against a pattern; returns params or null. */
export function matchPage(pattern: string, path: string): Record<string, string> | null {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const patternParts = pattern.split("/");
  const pathParts = normalized.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(":")) {
      if (!actual) return null;
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function isAdminPage(path: string): boolean {
  return Object.values(ADMIN_PAGES).some((pattern) => matchPage(pattern, path) !== null);
}
