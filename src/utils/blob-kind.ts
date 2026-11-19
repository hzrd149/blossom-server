/**
 * How the admin dashboard should treat a stored blob.
 * Blossom does not keep the original filename or which repo it came from.
 */

export type BlobKind =
  | "image"
  | "page"
  | "app"
  | "video"
  | "audio"
  | "text"
  | "unknown";

export type BlobListFilter =
  | "images"
  | "pages"
  | "apps"
  | "video"
  | "unlabeled"
  | "all";

const PAGE_MIMES = new Set([
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/json",
  "text/markdown",
  "text/plain",
  "image/svg+xml",
]);

export function blobKind(mime: string | null | undefined): BlobKind {
  if (!mime || mime === "application/octet-stream") return "unknown";
  const m = mime.toLowerCase();
  if (m === "image/svg+xml") return "page";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/vnd.android.package-archive") return "app";
  if (PAGE_MIMES.has(m)) return "page";
  if (m.startsWith("text/")) return "text";
  return "unknown";
}

export function blobKindLabel(kind: BlobKind): string {
  switch (kind) {
    case "image":
      return "Picture";
    case "page":
      return "Page file";
    case "app":
      return "Android app";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    case "text":
      return "Text";
    default:
      return "Unlabeled";
  }
}

/** SQL fragment for the admin list filter. Column is `type` or `b.type`. */
export function blobListFilterSql(
  kind: string | undefined,
  column: string,
): string | null {
  switch (kind) {
    case "images":
      return `${column} LIKE 'image/%' AND ${column} != 'image/svg+xml'`;
    case "pages":
      return `${column} IN ('text/html','text/css','text/javascript','application/javascript','application/json','text/markdown','text/plain','image/svg+xml')`;
    case "apps":
      return `${column} = 'application/vnd.android.package-archive'`;
    case "video":
      return `(${column} LIKE 'video/%' OR ${column} LIKE 'audio/%')`;
    case "unlabeled":
      return `(${column} IS NULL OR ${column} = '' OR ${column} = 'application/octet-stream')`;
    default:
      return null;
  }
}

/** A short, safe hint from the start of a page file. Not the whole file. */
export function pageFileHint(mime: string | null, head: string): string | null {
  const text = head.replace(/\0/g, "").trim();
  if (!text) return null;
  const m = (mime ?? "").toLowerCase();
  if (m === "text/html" || m === "image/svg+xml") {
    const title = text.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
    if (title) return title[1].trim();
    const h1 = text.match(/<h1[^>]*>([^<]{1,80})<\/h1>/i);
    if (h1) return h1[1].trim();
  }
  if (m === "text/markdown" || m === "text/plain") {
    const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    if (!line) return null;
    return line.replace(/^#+\s*/, "").slice(0, 80);
  }
  if (m === "text/css") return "Stylesheet";
  if (m === "text/javascript" || m === "application/javascript") return "Script";
  if (m === "application/json") return "JSON";
  if (m === "image/svg+xml") return "SVG";
  return null;
}
