import { mimeToExt } from "./mime.ts";

/** Derive the base URL for blob descriptors. */
export function getBaseUrl(request: Request, publicDomain: string): string {
  if (publicDomain) {
    // publicDomain is a bare hostname (e.g. "cdn.example.com").
    // Strip any accidental trailing slash and prepend https://.
    return `https://${publicDomain.replace(/\/$/, "")}`;
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
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
