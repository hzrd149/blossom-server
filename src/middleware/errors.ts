import type { Context } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";

/**
 * Create an HTTP error response with the BUD-01 X-Reason header.
 */
export function errorResponse(
  ctx: Context,
  status: 400 | 401 | 403 | 404 | 409 | 411 | 413 | 415 | 416 | 422 | 429 | 500 | 502 | 503 | 507,
  reason: string,
): Response {
  return ctx.body(reason, status, {
    "X-Reason": reason,
    "Content-Type": "text/plain",
  });
}

/**
 * Global fallback error handler for Hono (app.onError).
 *
 * This is a last-resort handler for errors that escape all middleware and
 * sub-app onError handlers. It preserves pre-built responses on HTTPException
 * (e.g. basicAuth's WWW-Authenticate header) rather than replacing them.
 *
 * Blossom-specific X-Reason formatting lives in the Blossom sub-app's own
 * onError — see src/routes/blossom-router.ts.
 */
export function onError(err: Error, ctx: Context): Response {
  if (err instanceof HTTPException) {
    // Honour a pre-built response attached to the exception (e.g. the 401
    // response from Hono's basicAuth middleware that carries WWW-Authenticate).
    if (err.res) {
      return err.res;
    }
    return ctx.body(err.message || "An error occurred", err.status, {
      "Content-Type": "text/plain",
    });
  }

  console.error("Unhandled error:", err);
  return ctx.body("Internal server error", 500, {
    "Content-Type": "text/plain",
  });
}
