export const SHA256_RE = /\b([0-9a-f]{64})\b/i;

/**
 * Parse a line of text as a Blossom URL or BUD-10 blossom: URI.
 *
 * Supported formats:
 *   - BUD-10:  blossom:<sha256>.<ext>[?xs=server&...]   (no "//" after scheme)
 *   - HTTP/S:  https://cdn.example.com/<sha256>[.ext]
 *   - Bare:    <64-char hex>
 *
 * Returns { displayUrl, mirrorUrl, sha256 }:
 *   - displayUrl  — shown in the UI (the original pasted string)
 *   - mirrorUrl   — HTTP/S URL sent to PUT /mirror body (resolved from xs param
 *                   for blossom: URIs, or the original for http/https)
 *   - sha256      — 64-char hex hash for the auth event x tag
 *
 * Returns null if no valid hash can be found.
 */
export function parseBlossomRef(
  raw: string,
): { displayUrl: string; mirrorUrl: string; sha256: string } | null {
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

    return { displayUrl: trimmed, mirrorUrl, sha256 };
  }

  // HTTP/HTTPS URL — hash must appear somewhere in the path
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") {
      const match = SHA256_RE.exec(u.pathname);
      if (match) {
        return {
          displayUrl: trimmed,
          mirrorUrl: trimmed,
          sha256: match[1].toLowerCase(),
        };
      }
    }
  } catch {
    // Not a URL — try bare 64-char hex hash
    const bare = trimmed.split(/[?#]/)[0];
    if (/^[0-9a-f]{64}$/i.test(bare)) {
      return {
        displayUrl: trimmed,
        mirrorUrl: trimmed,
        sha256: bare.toLowerCase(),
      };
    }
  }

  return null;
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
