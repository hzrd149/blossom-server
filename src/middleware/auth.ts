import type { Context, MiddlewareHandler } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { decodeBase64Url } from "@std/encoding/base64url";
import { verifyEvent } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";
import { debug } from "./debug.ts";

export interface AuthState {
  auth?: NostrEvent;
  authType?: string; // value of the "t" tag
  authExpiration?: number;
}

/**
 * Hono typed variable map for auth context variables.
 * Thread through Hono generics as `Hono<{ Variables: BlossomVariables }>` —
 * do NOT use `declare module` augmentation (disallowed by JSR publish rules).
 */
export interface BlossomVariables {
  auth: NostrEvent | undefined;
  authType: string | undefined;
  authExpiration: number | undefined;
}

/**
 * Extract a bare hostname from a value that may be a bare domain name or a
 * full URL. Never throws — returns null if the value is empty/falsy.
 *
 * Examples:
 *   "cdn.example.com"       → "cdn.example.com"
 *   "https://cdn.example.com" → "cdn.example.com"
 *   "http://localhost:3000"  → "localhost"
 *   ""                       → null
 */
export function extractHostname(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // If the value contains "://" treat it as a URL and extract the hostname.
  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      // Malformed URL — fall through and use the raw value as-is.
    }
  }
  // Bare domain (possibly with port): strip port and lowercase.
  return trimmed.split(":")[0].toLowerCase();
}

/**
 * Parse and validate a BUD-11 auth event from an Authorization header.
 * Throws HTTPException on any validation failure.
 *
 * BUD-11 requires Base64url encoding (JWT variant: no padding, - and _ instead
 * of + and /). Uses @std/encoding/base64url which handles both padded and
 * unpadded Base64url correctly.
 */
export function parseAuthEvent(
  raw: string,
  serverDomain: string | null,
): NostrEvent {
  const now = Math.floor(Date.now() / 1000);

  let auth: NostrEvent;
  try {
    // BUD-11 specifies Base64url; fall back to standard Base64 (atob) for
    // clients that encode with the standard alphabet (e.g. older nak versions).
    let decoded: string;
    try {
      decoded = new TextDecoder().decode(decodeBase64Url(raw));
    } catch {
      decoded = atob(raw);
    }
    auth = JSON.parse(decoded) as NostrEvent;
  } catch {
    throw new HTTPException(400, {
      message: "Invalid Authorization header encoding",
    });
  }

  // BUD-11 validation
  if (auth.kind !== 24242) {
    throw new HTTPException(400, { message: "Auth event must be kind 24242" });
  }
  const drift = auth.created_at - now;
  if (drift > 60) {
    throw new HTTPException(400, {
      message: `Auth event created_at is ${drift}s in the future`,
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

  // BUD-11: if server tags present, this server's domain must appear in at least one.
  // Normalize each tag value to a bare hostname in case clients send full URLs.
  const serverTags = auth.tags.filter((t) => t[0] === "server");
  if (serverTags.length > 0) {
    if (
      !serverDomain ||
      !serverTags.some((t) => extractHostname(t[1]) === serverDomain)
    ) {
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
export function authMiddleware(
  publicDomain: string,
): MiddlewareHandler<{ Variables: BlossomVariables }> {
  return async (ctx, next) => {
    const authHeader = ctx.req.header("authorization");

    if (authHeader?.startsWith("Nostr ")) {
      debug("[auth]", "Found Nostr auth header");

      const raw = authHeader.slice("Nostr ".length).trim();
      const domain = extractHostname(publicDomain) ??
        ctx.req.header("host")?.split(":")[0]?.toLowerCase() ?? null;

      debug("[auth]", "Extracted domain", domain);

      try {
        const auth = parseAuthEvent(raw, domain);
        debug("[auth]", "Parsed auth event", auth.tags);

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
        debug("[auth]", "Auth parse error", err);

        // Parse failure: leave auth undefined, let route handlers decide
        // if auth is required they will reject; if optional they won't care
        if (!(err instanceof HTTPException)) {
          console.warn("Auth parse error:", err);
          throw new HTTPException(500, { message: "Internal server error" });
        } // Else pass through the HTTPException
        else throw err;
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
  ctx: Context<{ Variables: BlossomVariables }>,
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
export function optionalAuth(
  ctx: Context<{ Variables: BlossomVariables }>,
): NostrEvent | undefined {
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
