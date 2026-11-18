import type { MiddlewareHandler } from "@hono/hono";
import type { BlossomVariables } from "./auth.ts";
import { errorResponse } from "./errors.ts";
import { isEnvelopeMime } from "../utils/mime.ts";

const ENVELOPE_REASON = "Send the raw file body; multipart and form-encoded requests are not supported";

function envelopeMimeForRequest(request: Request): string | null {
  const pathname = new URL(request.url).pathname;

  if (request.method === "PUT" && (pathname === "/upload" || pathname === "/media")) {
    return request.headers.get("Content-Type");
  }

  if (request.method === "HEAD" && pathname === "/upload") {
    return request.headers.get("X-Content-Type");
  }

  if (request.method === "HEAD" && pathname === "/media") {
    return request.headers.get("X-Content-Type") ?? request.headers.get("Content-Type");
  }

  return null;
}

/** Reject encoded upload envelopes before authentication or body processing. */
export function envelopeAdmissionMiddleware(): MiddlewareHandler<{ Variables: BlossomVariables }> {
  return async (ctx, next) => {
    if (!isEnvelopeMime(envelopeMimeForRequest(ctx.req.raw))) {
      await next();
      return;
    }

    if (ctx.req.method === "PUT") {
      await ctx.req.raw.body?.cancel();
    }

    return errorResponse(ctx, 415, ENVELOPE_REASON);
  };
}
