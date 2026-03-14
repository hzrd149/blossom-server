import { extension as extFromMime } from "@std/media-types";

/**
 * Derive the stored file extension from a MIME type.
 * Returns empty string for unknown types or application/octet-stream.
 * Uses @std/media-types for comprehensive MIME → extension coverage.
 */
export function mimeToExt(mime: string | null): string {
  if (!mime || mime === "application/octet-stream") return "";
  return extFromMime(mime) ?? "";
}
