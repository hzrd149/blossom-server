import { mimeToExt } from "./mime.ts";

const ENCODED_SEPARATOR_RE = /%(?:25)*(?:2f|5c)/i;
const MAX_STATIC_PATH_CODE_POINTS = 2_048;
const MAX_STATIC_SEGMENT_CODE_POINTS = 255;

function hasUnsafeDecodedCharacter(text: string): boolean {
  return [...text].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "\\" || codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

/** Return whether an encoded URL pathname is safe to pass to filesystem-backed static middleware. */
export function isStaticCandidate(encodedPathname: string): boolean {
  if (ENCODED_SEPARATOR_RE.test(encodedPathname)) return false;

  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(encodedPathname);
  } catch {
    return false;
  }

  if (!decodedPathname.startsWith("/")) return false;
  if ([...decodedPathname].length > MAX_STATIC_PATH_CODE_POINTS) return false;
  if (hasUnsafeDecodedCharacter(decodedPathname)) return false;

  const segments = decodedPathname.slice(1).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  return segments.every((segment) => [...segment].length <= MAX_STATIC_SEGMENT_CODE_POINTS);
}

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
