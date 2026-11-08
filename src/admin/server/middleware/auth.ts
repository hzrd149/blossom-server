import { basicAuth } from "@hono/hono/basic-auth";
import type { MiddlewareHandler } from "@hono/hono";
import type { Config } from "../../../config/schema.ts";

export function adminAuth(config: Config): MiddlewareHandler {
  return basicAuth({ username: config.dashboard.username, password: config.dashboard.password });
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
