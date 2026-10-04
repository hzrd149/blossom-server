import { extension as extFromMime } from "@std/media-types";

/** Return whether a request MIME value wraps a raw blob in an encoded envelope. */
export function isEnvelopeMime(value: string | null | undefined): boolean {
  const baseMime = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return baseMime.startsWith("multipart/") || baseMime === "application/x-www-form-urlencoded";
}

/** Return whether a stored MIME value represents browser-active document content. */
export function isActiveContentMime(value: string | null | undefined): boolean {
  const baseMime = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (baseMime === "text/html" || baseMime === "text/xml" || baseMime === "application/xml") {
    return true;
  }

  const slash = baseMime.indexOf("/");
  return slash > 0 && baseMime.slice(slash + 1, -4).length > 0 && baseMime.endsWith("+xml");
}

/**
 * Derive the stored file extension from a MIME type.
 * Returns empty string for unknown types or application/octet-stream.
 * Uses @std/media-types for comprehensive MIME → extension coverage.
 */
export function mimeToExt(mime: string | null): string {
  if (!mime || mime === "application/octet-stream") return "";
  return extFromMime(mime) ?? "";
}
