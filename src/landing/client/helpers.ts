import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const SHA256_RE = /\b([0-9a-f]{64})\b/i;
const SHA256_RE_GLOBAL = /\b([0-9a-f]{64})\b/gi;

export interface BlossomRef {
  displayUrl: string;
  mirrorUrl: string;
  /** Primary hash (last one found in the path — typically the blob filename). */
  sha256: string;
  /** All unique 64-char hex hashes found in the URL, for auth x-tags. */
  allHashes: string[];
}

/**
 * Parse a line of text as a Blossom URL or BUD-10 blossom: URI.
 *
 * Supported formats:
 *   - BUD-10:  blossom:<sha256>.<ext>[?xs=server&...]   (no "//" after scheme)
 *   - HTTP/S:  https://cdn.example.com/<sha256>[.ext]
 *   - Bare:    <64-char hex>
 *
 * Returns { displayUrl, mirrorUrl, sha256, allHashes }:
 *   - displayUrl  — shown in the UI (the original pasted string)
 *   - mirrorUrl   — HTTP/S URL sent to PUT /mirror body (resolved from xs param
 *                   for blossom: URIs, or the original for http/https)
 *   - sha256      — primary 64-char hex hash (last one in the path)
 *   - allHashes   — every unique 64-char hex hash found in the URL; URLs with
 *                   nested paths (e.g. /media/<hash1>/<hash2>.webp) will have
 *                   multiple entries so the auth event covers all of them
 *
 * Returns null if no valid hash can be found.
 */
export function parseBlossomRef(raw: string): BlossomRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // BUD-10: blossom:<sha256>.<ext>[?params]
  // Scheme is "blossom:" followed immediately by the hash — no "//".
  if (/^blossom:/i.test(trimmed)) {
    const rest = trimmed.slice("blossom:".length);
    // Hash is everything before the first "." or "?"
    const hashPart = rest.split(/[.?]/)[0];
    const match = SHA256_RE.exec(hashPart);
    if (!match) return null;
    const sha256 = match[1].toLowerCase();

    // Extract extension and xs (server hint) from the URI
    const dotIdx = rest.indexOf(".");
    const extAndQuery = dotIdx >= 0 ? rest.slice(dotIdx) : "";
    const qIdx = extAndQuery.indexOf("?");
    const ext = qIdx >= 0 ? extAndQuery.slice(0, qIdx) : extAndQuery; // e.g. ".pdf"
    const query = qIdx >= 0 ? extAndQuery.slice(qIdx + 1) : "";

    // Resolve to an HTTP URL using the first xs hint, or fall back to bare hash path
    let mirrorUrl: string;
    const params = new URLSearchParams(query);
    const xs = params.get("xs");
    if (xs) {
      // xs may include a scheme or just a domain
      const base = /^https?:\/\//i.test(xs) ? xs : `https://${xs}`;
      mirrorUrl = `${base.replace(/\/$/, "")}/${sha256}${ext || ""}`;
    } else {
      // No server hint — we can't resolve it to HTTP; store the blossom: URI
      // and the server will reject it with a useful error
      mirrorUrl = trimmed;
    }

    return { displayUrl: trimmed, mirrorUrl, sha256, allHashes: [sha256] };
  }

  // HTTP/HTTPS URL — collect all 64-char hex hashes in the path
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") {
      const allHashes = findAllHashes(u.pathname);
      if (allHashes.length > 0) {
        return {
          displayUrl: trimmed,
          mirrorUrl: trimmed,
          sha256: allHashes[allHashes.length - 1],
          allHashes,
        };
      }
    }
  } catch {
    // Not a URL — try bare 64-char hex hash
    const bare = trimmed.split(/[?#]/)[0];
    if (/^[0-9a-f]{64}$/i.test(bare)) {
      const sha256 = bare.toLowerCase();
      return {
        displayUrl: trimmed,
        mirrorUrl: trimmed,
        sha256,
        allHashes: [sha256],
      };
    }
  }

  return null;
}

/** Extract all unique 64-char hex hashes from a string, preserving order. */
function findAllHashes(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of text.matchAll(SHA256_RE_GLOBAL)) {
    const h = m[1].toLowerCase();
    if (!seen.has(h)) {
      seen.add(h);
      result.push(h);
    }
  }
  return result;
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return bytesToHex(sha256(new Uint8Array(buf)));
}

export function createClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val % 1 === 0 ? val : val.toFixed(2)} ${units[i]}`;
}

export function isMediaFile(file: File): boolean {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

const STATUS_MESSAGES: Record<number, string> = {
  401: "Authorization required \u2014 connect a Nostr signing extension",
  402: "Payment required",
  409: "Hash mismatch \u2014 the file changed during upload",
  413: "File too large for this server",
  415: "This file type is not accepted by the server",
  422: "Media could not be processed (corrupt or unsupported codec)",
  429: "Rate limited \u2014 retrying automatically\u2026",
  502: "Could not fetch the blob from the source URL",
  503: "Server temporarily unavailable",
};

/** Map an HTTP status code to actionable user-facing text. */
export function friendlyErrorMessage(status: number, xReason?: string): string {
  const base = STATUS_MESSAGES[status];
  if (base && xReason) return `${base} \u2014 ${xReason}`;
  if (base) return base;
  return `Error (${status}): ${xReason || "Unknown error"}`;
}
