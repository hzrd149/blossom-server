/**
 * IP address and CIDR range helpers — pure, no I/O.
 *
 * Every address is normalised to a 128-bit IPv6 value; IPv4 addresses are
 * represented as IPv4-mapped IPv6 (::ffff:a.b.c.d) so a single range check
 * covers both families and "1.2.3.4" matches "::ffff:1.2.3.4".
 */

import { parseIPv4, parseIPv6 } from "../utils/ip-guard.ts";

const IPV4_MAPPED_PREFIX = 0xffffn << 32n;
const IPV4_MAPPED_MASK = ((1n << 96n) - 1n) << 32n;
const MAX = (1n << 128n) - 1n;

export interface IpRange {
  /** Canonical CIDR spelling, e.g. "203.0.113.0/24" or "2001:db8::/32". */
  cidr: string;
  start: bigint;
  end: bigint;
}

/** Parse an IPv4 or IPv6 literal into its normalised 128-bit value. */
export function parseIp(input: string): bigint | null {
  const value = input.trim();
  const v4 = parseIPv4(value);
  if (v4) return IPV4_MAPPED_PREFIX | BigInt((v4[0] << 24 >>> 0) + (v4[1] << 16) + (v4[2] << 8) + v4[3]);
  return parseIPv6(value);
}

function isMappedV4(value: bigint): boolean {
  return (value & IPV4_MAPPED_MASK) === IPV4_MAPPED_PREFIX;
}

/** Format a normalised address back into its shortest conventional spelling. */
export function formatIp(value: bigint): string {
  if (isMappedV4(value)) {
    const n = Number(value & 0xffffffffn);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) groups.push(((value >> BigInt(i * 16)) & 0xffffn).toString(16));
  // Compress the longest run of zero groups (RFC 5952).
  let bestStart = -1, bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === "0") j++;
    if (j - i > bestLen && j - i > 1) [bestStart, bestLen] = [i, j - i];
    i = j;
  }
  if (bestStart === -1) return groups.join(":");
  return `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLen).join(":")}`;
}

/** Normalise an address string (e.g. "::ffff:1.2.3.4" → "1.2.3.4"), or null if invalid. */
export function normalizeIp(input: string): string | null {
  const value = parseIp(input);
  return value === null ? null : formatIp(value);
}

/**
 * Parse "a.b.c.d", "a.b.c.d/nn", "v6::", or "v6::/nn" into an inclusive range.
 * Host bits below the prefix are cleared, so "10.1.2.3/8" becomes "10.0.0.0/8".
 */
export function parseCidr(input: string): IpRange | null {
  const [addr, prefixText, extra] = input.trim().split("/");
  if (extra !== undefined || !addr) return null;
  const value = parseIp(addr);
  if (value === null) return null;
  const v4 = parseIPv4(addr.trim()) !== null;
  const maxPrefix = v4 ? 32 : 128;
  let prefix = maxPrefix;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > maxPrefix) return null;
  }
  const bits = BigInt((v4 ? 96 : 0) + prefix);
  const hostMask = bits === 128n ? 0n : MAX >> bits;
  const start = value & (MAX ^ hostMask);
  const end = start | hostMask;
  return { cidr: `${formatIp(start)}/${prefix}`, start, end };
}

/** Whether a normalised address falls inside any of the given ranges. */
export function ipInRanges(ip: bigint, ranges: readonly IpRange[]): boolean {
  for (const range of ranges) if (ip >= range.start && ip <= range.end) return true;
  return false;
}
