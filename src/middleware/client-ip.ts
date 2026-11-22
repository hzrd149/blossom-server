/**
 * Client IP resolution — sets ctx.var.clientIp for enforcement and activity logging.
 *
 * The socket peer address is authoritative. A forwarding header is consulted
 * only when the peer is a configured trusted proxy, so clients cannot spoof
 * their address by sending X-Forwarded-For directly. Never blocks a request.
 */

import type { Context, MiddlewareHandler } from "@hono/hono";
import { getConnInfo } from "@hono/hono/deno";
import type { NetworkConfig } from "../config/schema.ts";
import { formatIp, ipInRanges, type IpRange, parseCidr, parseIp } from "../policy/cidr.ts";

export interface ClientIpVariables {
  clientIp: string | null;
}

function peerAddress(ctx: Context): string | null {
  try {
    return getConnInfo(ctx).remote.address ?? null;
  } catch {
    // app.fetch() without Deno connection info (tests, embedding) has no peer.
    return null;
  }
}

/** Extract the `for=` node of each RFC 7239 Forwarded element, in order. */
function forwardedFor(header: string): string[] {
  const hops: string[] = [];
  for (const element of header.split(",")) {
    for (const pair of element.split(";")) {
      const [key, ...rest] = pair.trim().split("=");
      if (key?.toLowerCase() !== "for") continue;
      let value = rest.join("=").trim().replace(/^"|"$/g, "");
      // [2001:db8::1]:443 → 2001:db8::1, 192.0.2.1:443 → 192.0.2.1
      if (value.startsWith("[")) value = value.slice(1, value.indexOf("]"));
      else if (value.split(":").length === 2) value = value.split(":")[0];
      hops.push(value);
    }
  }
  return hops;
}

/**
 * Resolve the client address from a peer and the configured proxy header.
 * Exported for unit tests; returns a normalised address or null.
 */
export function resolveClientIp(
  peer: string | null,
  headerValue: string | undefined,
  header: NetworkConfig["clientIpHeader"],
  trusted: readonly IpRange[],
): string | null {
  const peerValue = peer === null ? null : parseIp(peer);
  if (peerValue === null) return null;
  if (!headerValue || trusted.length === 0 || !ipInRanges(peerValue, trusted)) return formatIp(peerValue);

  if (header === "x-real-ip" || header === "cf-connecting-ip") {
    const value = parseIp(headerValue);
    return value === null ? formatIp(peerValue) : formatIp(value);
  }

  // Multi-hop headers: walk right to left, skipping our own trusted proxies.
  const hops = header === "forwarded" ? forwardedFor(headerValue) : headerValue.split(",").map((hop) => hop.trim());
  let candidate: bigint | null = null;
  for (let i = hops.length - 1; i >= 0; i--) {
    const value = parseIp(hops[i]);
    if (value === null) break; // Malformed hop: stop trusting anything further left.
    candidate = value;
    if (!ipInRanges(value, trusted)) break;
  }
  return formatIp(candidate ?? peerValue);
}

export function clientIpMiddleware(network: NetworkConfig): MiddlewareHandler<{ Variables: ClientIpVariables }> {
  const trusted = network.trustedProxies.map((cidr) => parseCidr(cidr)).filter((range): range is IpRange => range !== null);
  return async (ctx, next) => {
    ctx.set("clientIp", resolveClientIp(peerAddress(ctx), ctx.req.header(network.clientIpHeader), network.clientIpHeader, trusted));
    await next();
  };
}

/** The resolved client IP, or null when unknown or the middleware did not run. */
export function getClientIp(ctx: Context): string | null {
  return (ctx.get("clientIp") as string | null | undefined) ?? null;
}
