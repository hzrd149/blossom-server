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

/**
 * Detects MIME types that indicate the request body is a transport envelope
 * (form-encoding) rather than the file's own bytes.
 *
 * BUD-02 expects the raw file body with the file's own Content-Type. Accepting
 * envelope types historically stored the whole multipart envelope as the blob:
 * incident 2026-08-27 — five blobs stored with type `multipart/form-data` and
 * envelope bytes (unrenderable). Callers should reject these with 415.
 *
 * Normalizes case/whitespace; compare against the bare MIME (before `;` params).
 */
export function isEnvelopeMime(mime: string): boolean {
  const m = mime.trim().toLowerCase();
  return m === "application/x-www-form-urlencoded" ||
    m.startsWith("multipart/");
}
