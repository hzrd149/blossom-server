import type { MiddlewareHandler } from "@hono/hono";

/**
 * Request/response logger middleware.
 * Logs method, path, status, elapsed time, and X-Reason (if present).
 *
 * Output format:
 *   --> GET /upload
 *   <-- GET /upload 200 4ms
 *   <-- PUT /upload 403 1ms  Auth token expired
 */
export const requestLogger: MiddlewareHandler = async (ctx, next) => {
  const { method } = ctx.req;
  const url = ctx.req.url;
  const path = url.slice(url.indexOf("/", 8));

  console.log(`--> ${method} ${path}`);

  const start = Date.now();
  await next();

  const status = ctx.res.status;
  const elapsed = Date.now() - start;
  const elapsedStr = elapsed < 1000
    ? `${elapsed}ms`
    : `${Math.round(elapsed / 1000)}s`;
  const reason = ctx.res.headers.get("x-reason");

  console.log(
    `<-- ${method} ${path} ${status} ${elapsedStr}${
      reason ? `  ${reason}` : ""
    }`,
  );
};
