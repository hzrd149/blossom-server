import { mimeToExt } from "./mime.ts";

/**
 * Derive the request scheme, honouring reverse-proxy headers.
 * Behind a TLS-terminating proxy `request.url` is always `http://…`, so we
 * prefer `X-Forwarded-Proto` (de-facto standard) and the RFC 7239 `Forwarded`
 * header before falling back to the connection scheme.
 */
function getProtocol(request: Request): string {
  const xfp = request.headers.get("x-forwarded-proto");
  if (xfp) {
    // Comma-separated list when traversing multiple proxies — first hop is the client.
    const proto = xfp.split(",")[0].trim().toLowerCase();
    if (proto === "https" || proto === "http") return `${proto}:`;
  }
  const forwarded = request.headers.get("forwarded");
  if (forwarded) {
    const match = forwarded.match(/proto\s*=\s*"?([A-Za-z]+)"?/);
    if (match) {
      const proto = match[1].toLowerCase();
      if (proto === "https" || proto === "http") return `${proto}:`;
    }
  }
  return new URL(request.url).protocol;
}

/** Derive the base URL for blob descriptors. */
export function getBaseUrl(request: Request, publicDomain: string): string {
  const protocol = getProtocol(request);
  if (publicDomain) {
    // publicDomain is a bare hostname (e.g. "cdn.example.com").
    // Mirror the incoming request scheme so returned descriptors stay valid.
    return `${protocol}//${publicDomain.replace(/\/$/, "")}`;
  }
  const url = new URL(request.url);
  return `${protocol}//${url.host}`;
}

/** Build the full URL for a blob given its hash, MIME type, and base URL. */
export function getBlobUrl(
  hash: string,
  mimeType: string | null,
  baseUrl: string,
): string {
  const ext = mimeToExt(mimeType);
  return `${baseUrl}/${hash}${ext ? `.${ext}` : ""}`;
}

/**
 * Whether a request path can name a file in the flat ./public directory
 * (favicon.ico, client.js). Public assets are a single short segment of
 * `[A-Za-z0-9._-]`; anything else — scanner slop, encoded JSON glued onto a
 * URL, nested or `..` paths — cannot be an asset, so callers skip the static
 * middleware entirely instead of stat'ing an absurd decoded filename on disk
 * (ENAMETOOLONG on paths over ~255 bytes).
 */
export function isServeStaticCandidate(pathname: string): boolean {
  if (pathname.includes("..")) return false;
  return /^\/[A-Za-z0-9._-]{1,128}$/.test(pathname);
}
