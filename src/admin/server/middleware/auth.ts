import { basicAuth } from "@hono/hono/basic-auth";
import { HTTPException } from "@hono/hono/http-exception";
import type { MiddlewareHandler } from "@hono/hono";
import type { Config } from "../../../config/schema.ts";
import { getClientIp } from "../../../middleware/client-ip.ts";

const FAILURE_TTL = 15 * 60_000;

/** Process-local failure tracking; no timers or per-request sleeps. */
export function adminAuth(
  config: Config,
  { now = Date.now, maxEntries = 10_000 }: { now?: () => number; maxEntries?: number } = {},
): MiddlewareHandler {
  const authenticate = basicAuth({ username: config.dashboard.username, password: config.dashboard.password });
  const failures = new Map<string, { count: number; updated: number; blockedUntil: number }>();
  return async (c, next) => {
    // Missing socket information shares one bucket; never trust raw forwarding headers here.
    const key = getClientIp(c) ?? "unknown";
    const time = now();
    let previous = failures.get(key);
    if (previous && time - previous.updated >= FAILURE_TTL) {
      failures.delete(key);
      previous = undefined;
    }
    if (previous && previous.blockedUntil > time) {
      await c.req.raw.body?.cancel();
      c.header("Retry-After", String(Math.ceil((previous.blockedUntil - time) / 1000)));
      c.header("Cache-Control", "no-store");
      return c.json({ error: "Too many failed admin authentication attempts" }, 429);
    }
    try {
      // Keep downstream errors outside this catch: only credential failures count.
      await authenticate(c, async () => {});
    } catch (error) {
      if (!(error instanceof HTTPException) || error.status !== 401) throw error;
      // The initial browser challenge is not a failed password attempt.
      if (c.req.header("Authorization") !== undefined) {
        const failedAt = now();
        const current = failures.get(key);
        const count = current && failedAt - current.updated < FAILURE_TTL ? Math.min(current.count + 1, 11) : 1;
        failures.delete(key);
        if (failures.size >= maxEntries) {
          for (const [address, entry] of failures) {
            if (failedAt - entry.updated >= FAILURE_TTL) failures.delete(address);
          }
          if (failures.size >= maxEntries) failures.delete(failures.keys().next().value!);
        }
        failures.set(key, {
          count,
          updated: failedAt,
          blockedUntil: failedAt + (count >= 5 ? Math.min(60_000, 1000 * 2 ** (count - 5)) : 0),
        });
      }
      await c.req.raw.body?.cancel();
      const response = error.getResponse();
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    failures.delete(key);
    await next();
  };
}

/** Reject browser mutations from other sites/hosts. Authenticated non-browser clients may omit Origin. */
export const adminMutationGuard: MiddlewareHandler = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    // Host comparison accommodates TLS termination without trusting forwarded host headers.
    let sameHost = false;
    try {
      const parsed = origin ? new URL(origin) : undefined;
      sameHost = !!parsed && ["http:", "https:"].includes(parsed.protocol) && parsed.host === new URL(c.req.url).host;
    } catch { /* Invalid origins are rejected below. */ }
    const fetchSite = c.req.header("Sec-Fetch-Site");
    if ((fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") || (origin && !sameHost)) {
      await c.req.raw.body?.cancel();
      return c.json({ error: "Cross-origin admin mutation rejected" }, 403);
    }
  }
  await next();
};
