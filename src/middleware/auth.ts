import type { Context, MiddlewareHandler } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { decodeBase64Url } from "@std/encoding/base64url";
import { verifyEvent } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

export interface AuthState {
  auth?: NostrEvent;
  authType?: string; // value of the "t" tag
  authExpiration?: number;
}

// Hono variable declarations for ctx.get() / ctx.set()
declare module "@hono/hono" {
  interface ContextVariableMap {
    auth: NostrEvent | undefined;
    authType: string | undefined;
    authExpiration: number | undefined;
  }
}

/**
 * Parse and validate a BUD-11 auth event from an Authorization header.
 * Throws HTTPException on any validation failure.
 *
 * BUD-11 requires Base64url encoding (JWT variant: no padding, - and _ instead
 * of + and /). Uses @std/encoding/base64url which handles both padded and
 * unpadded Base64url correctly.
 */
export function parseAuthEvent(raw: string, serverDomain: string | null): NostrEvent {
  const now = Math.floor(Date.now() / 1000);

  let auth: NostrEvent;
  try {
    auth = JSON.parse(new TextDecoder().decode(decodeBase64Url(raw))) as NostrEvent;
  } catch {
    throw new HTTPException(400, {
      message: "Invalid Authorization header encoding",
    });
  }

  // BUD-11 validation
  if (auth.kind !== 24242) {
    throw new HTTPException(400, { message: "Auth event must be kind 24242" });
  }
  if (auth.created_at > now) {
    throw new HTTPException(400, {
      message: "Auth event created_at is in the future",
    });
  }

  const expiration = auth.tags.find((t) => t[0] === "expiration")?.[1];
  if (!expiration) {
    throw new HTTPException(400, {
      message: "Auth event missing expiration tag",
    });
  }
  if (parseInt(expiration, 10) < now) {
    throw new HTTPException(401, { message: "Auth token expired" });
  }

  const tTag = auth.tags.find((t) => t[0] === "t")?.[1];
  if (!tTag) {
    throw new HTTPException(400, { message: "Auth event missing t tag" });
  }

  // BUD-11: if server tags present, this server's domain must appear in at least one
  const serverTags = auth.tags.filter((t) => t[0] === "server");
  if (serverTags.length > 0) {
    if (!serverDomain || !serverTags.some((t) => t[1] === serverDomain)) {
      throw new HTTPException(401, {
        message: "Auth token not valid for this server",
      });
    }
  }

  // Verify signature last (most expensive)
  if (!verifyEvent(auth)) {
    throw new HTTPException(400, { message: "Auth event signature invalid" });
  }

  return auth;
}

/**
 * Global auth middleware — parse-only, never blocks.
 * Populates ctx variables: auth, authType, authExpiration.
 * Call requireAuth() or optionalAuth() in route handlers for enforcement.
 */
export function authMiddleware(publicDomain: string): MiddlewareHandler {
  return async (ctx, next) => {
    const authHeader = ctx.req.header("authorization");
    if (authHeader?.startsWith("Nostr ")) {
      const raw = authHeader.slice("Nostr ".length).trim();
      const domain = publicDomain
        ? new URL(publicDomain).hostname.toLowerCase()
        : ctx.req.header("host")?.split(":")[0]?.toLowerCase() ?? null;

      try {
        const auth = parseAuthEvent(raw, domain);
        ctx.set("auth", auth);
        ctx.set("authType", auth.tags.find((t) => t[0] === "t")?.[1]);
        ctx.set(
          "authExpiration",
          parseInt(
            auth.tags.find((t) => t[0] === "expiration")?.[1] ?? "0",
            10,
          ),
        );
      } catch (err) {
        // Parse failure: leave auth undefined, let route handlers decide
        // if auth is required they will reject; if optional they won't care
        if (!(err instanceof HTTPException)) {
          console.warn("Auth parse error:", err);
        }
      }
    }
    await next();
  };
}

/**
 * Enforce authentication in a route handler.
 * Throws 401 if no valid auth is present, or 403 if the t tag doesn't match.
 *
 * @param ctx   Hono context
 * @param verb  Required BUD-11 verb: "get" | "upload" | "list" | "delete" | "media"
 */
export function requireAuth(
  ctx: Context,
  verb: "get" | "upload" | "list" | "delete" | "media",
): NostrEvent {
  const auth = ctx.get("auth");
  if (!auth) {
    throw new HTTPException(401, { message: "Authorization required" });
  }
  const authType = ctx.get("authType");
  if (authType !== verb) {
    throw new HTTPException(403, {
      message:
        `Auth token type "${authType}" does not match required "${verb}"`,
    });
  }
  return auth;
}

/**
 * Get auth if present, without enforcing it.
 * Returns undefined if no auth header or if parsing failed.
 */
export function optionalAuth(ctx: Context): NostrEvent | undefined {
  return ctx.get("auth");
}

/**
 * Verify that an auth event's x tags include the given hash.
 * Required for upload, delete operations per BUD-11.
 */
export function requireXTag(auth: NostrEvent, hash: string): void {
  const xTags = auth.tags.filter((t) => t[0] === "x");
  if (xTags.length > 0 && !xTags.some((t) => t[1] === hash)) {
    throw new HTTPException(403, {
      message: `Auth token does not authorize operation on blob ${hash}`,
    });
  }
}
