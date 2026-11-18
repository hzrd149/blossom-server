const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1,
  );
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(value < 10 ? 2 : 1)} ${UNITS[i]}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** Unix seconds → locale date and time. */
export function formatDate(unix: number | null | undefined): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString();
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** Unix seconds → "3 hours ago" / "in 2 days". */
export function formatRelative(unix: number | null | undefined): string {
  if (!unix) return "never";
  const delta = unix - Date.now() / 1000;
  for (const [unit, seconds] of STEPS) {
    if (Math.abs(delta) >= seconds) {
      return RTF.format(Math.round(delta / seconds), unit);
    }
  }
  return RTF.format(Math.round(delta), "second");
}

export function shortHash(hash: string, length = 8): string {
  return hash.length > length * 2
    ? `${hash.slice(0, length)}…${hash.slice(-4)}`
    : hash;
}

export function mediaKind(
  type: string | null,
): "image" | "video" | "audio" | null {
  const group = type?.split("/")[0];
  return group === "image" || group === "video" || group === "audio"
    ? group
    : null;
}
