import { extension as extFromMime } from "@std/media-types";

/** Return whether a request MIME value wraps a raw blob in an encoded envelope. */
export function isEnvelopeMime(value: string | null | undefined): boolean {
  const baseMime = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return baseMime.startsWith("multipart/") || baseMime === "application/x-www-form-urlencoded";
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
