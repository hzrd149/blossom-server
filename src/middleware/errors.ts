import type { Context } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";

/**
 * Create an HTTP error response with the BUD-01 X-Reason header.
 */
export function errorResponse(
  ctx: Context,
  status: 400 | 401 | 403 | 404 | 411 | 413 | 415 | 429 | 500 | 502 | 503,
  reason: string,
): Response {
  return ctx.body(reason, status, {
    "X-Reason": reason,
    "Content-Type": "text/plain",
  });
}

/**
 * Global error handler for Hono — catches HTTPException and unhandled errors.
 */
export function onError(err: Error, ctx: Context): Response {
  if (err instanceof HTTPException) {
    const reason = err.message || "An error occurred";
    return ctx.body(reason, err.status, {
      "X-Reason": reason,
      "Content-Type": "text/plain",
    });
  }

  console.error("Unhandled error:", err);
  return ctx.body("Internal server error", 500, {
    "X-Reason": "Internal server error",
    "Content-Type": "text/plain",
  });
}
