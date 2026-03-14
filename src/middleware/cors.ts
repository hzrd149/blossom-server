import { cors } from "@hono/hono/cors";

/**
 * BUD-01 CORS middleware.
 *
 * All responses must set Access-Control-Allow-Origin: *
 * OPTIONS preflight must also set Allow-Headers and Allow-Methods.
 */
export const corsMiddleware = cors({
  origin: "*",
  allowHeaders: ["Authorization", "Content-Type", "*"],
  allowMethods: ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["X-Reason", "Content-Range"],
  maxAge: 86400,
});
