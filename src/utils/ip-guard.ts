/**
 * SSRF guard primitives for outbound fetches (PUT /mirror, BUD-04).
 *
 * Classifies literal IPv4/IPv6 hostnames and DNS-resolved addresses against
 * lists of non-public ranges. All functions are pure (no network) so they are
 * unit-testable without DNS or a server.
 *
 * Notes:
 * - Non-canonical IPv4 spellings (decimal `2130706433`, hex `0x7f.0.0.1`,
 *   octal) are canonicalised by the WHATWG URL parser before the hostname
 *   reaches us, so only dotted-quad needs handling here.
 * - IPv6 embedded-IPv4 translations are covered: IPv4-mapped (`::ffff:a.b.c.d`
 *   and `::ffff:hex:hex`), IPv4-compatible (`::a.b.c.d`), NAT64
 *   (`64:ff9b::a.b.c.d`) and 6to4 (`2002:ab:cd::`).
 * - DNS-based rebinding between the resolve-time check and the fetch is a
 *   residual race: Deno's fetch does not support pinning a resolved address.
 *   The resolve-time validation closes the "hostname that statically resolves
 *   to a private IP" class; the redirect re-validation closes redirect-based
 *   bypasses.
 */

/** Returns the four octets of a strict dotted-quad IPv4 string, or null. */
export function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Parses any valid IPv6 spelling into a 128-bit bigint, or null. */
export function parseIPv6(host: string): bigint | null {
  // Strip zone index (%eth0) and brackets.
  const bare = host.replace(/^\[/, "").replace(/\].*$/, "").split("%")[0];
  if (!bare.includes(":")) return null;

  // Embedded IPv4 tail (::ffff:1.2.3.4) → replace with two placeholder groups.
  let s = bare;
  let v4tail: number[] | null = null;
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    v4tail = parseIPv4(tail);
    if (!v4tail) return null;
    s = s.slice(0, lastColon + 1) + "0:0";
  }

  const dblIdx = s.indexOf("::");
  if (dblIdx !== -1 && s.indexOf("::", dblIdx + 1) !== -1) return null; // multiple "::"

  let headGroups: string[], tailGroups: string[];
  if (dblIdx === -1) {
    const groups = s.split(":");
    if (groups.length !== 8) return null;
    headGroups = groups;
    tailGroups = [];
  } else {
    headGroups = s.slice(0, dblIdx).split(":").filter((g) => g !== "");
    tailGroups = s.slice(dblIdx + 2).split(":").filter((g) => g !== "");
  }
  const present = headGroups.length + tailGroups.length;
  const missing = 8 - present;
  if (missing < 0) return null;
  if (dblIdx === -1 && missing !== 0) return null;

  const groups = [
    ...headGroups,
    ...Array<string>(missing).fill("0"),
    ...tailGroups,
  ];
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  if (v4tail) {
    // The two placeholder groups sit at the end — overwrite with the v4 octets.
    value = (value & ~0xffffffffn) |
      ((BigInt(v4tail[0]) << 24n) | (BigInt(v4tail[1]) << 16n) |
        (BigInt(v4tail[2]) << 8n) | BigInt(v4tail[3]));
  }
  return value;
}

/** Returns a reason string when a dotted-quad IPv4 is not a public address. */
export function classifyIPv4(octets: number[]): string | null {
  const [a, b] = octets;
  const table: Array<[boolean, string]> = [
    [a === 0, "unspecified (0.0.0.0/8)"],
    [a === 10, "private (10.0.0.0/8)"],
    [a === 100 && b >= 64 && b <= 127, "CGNAT (100.64.0.0/10)"],
    [a === 127, "loopback (127.0.0.0/8)"],
    [a === 169 && b === 254, "link-local (169.254.0.0/16)"],
    [a === 172 && b >= 16 && b <= 31, "private (172.16.0.0/12)"],
    [a === 192 && b === 0 && octets[2] === 0, "IANA special (192.0.0.0/24)"],
    [a === 192 && b === 0 && octets[2] === 2, "documentation (192.0.2.0/24)"],
    [a === 192 && b === 168, "private (192.168.0.0/16)"],
    [a === 198 && (b === 18 || b === 19), "benchmarking (198.18.0.0/15)"],
    [
      a === 198 && b === 51 && octets[2] === 100,
      "documentation (198.51.100.0/24)",
    ],
    [
      a === 203 && b === 0 && octets[2] === 113,
      "documentation (203.0.113.0/24)",
    ],
    [a >= 224 && a <= 239, "multicast (224.0.0.0/4)"],
    [a >= 240, "reserved (240.0.0.0/4)"],
  ];
  for (const [hit, reason] of table) {
    if (hit) return `IPv4 ${reason}`;
  }
  return null;
}

/** Returns a reason string when an IPv6 value (bigint) is not a public address. */
export function classifyIPv6(v: bigint): string | null {
  const topByte = v >> 120n;
  if (v === 0n) return "IPv6 unspecified (::)";
  if (v === 1n) return "IPv6 loopback (::1)";
  if (topByte === 0xfcn || topByte === 0xfdn) return "IPv6 ULA (fc00::/7)";
  if (
    topByte === 0xfen && ((v >> 112n) & 0xffn) >= 0x80n &&
    ((v >> 112n) & 0xffn) <= 0xbfn
  ) {
    return "IPv6 link-local (fe80::/10)";
  }
  if (topByte === 0xffn) return "IPv6 multicast (ff00::/8)";
  // IPv4-mapped: ::ffff:0:0/96 — also catches hex spellings like ::ffff:7f00:1
  if (v >> 96n === 0xffffn) {
    const reason = classifyIPv4(ipv4FromLow32(v)!);
    if (reason) return `IPv4-mapped ${reason}`;
  }
  // NAT64: 64:ff9b::/96
  if (v >> 96n === 0x64ff9bn) {
    const reason = classifyIPv4(ipv4FromLow32(v)!);
    if (reason) return `NAT64-embedded ${reason}`;
  }
  // 6to4: 2002::/16 — the embedded v4 bits live in bits 16..47
  if (v >> 112n === 0x2002n) {
    const reason = classifyIPv4(ipv4FromBits(v, 80n)!);
    if (reason) return `6to4-embedded ${reason}`;
  }
  // Teredo: 2001::/32
  if (v >> 96n === 0x20010000n) return "IPv6 Teredo (2001::/32)";
  // Documentation: 2001:db8::/32
  if (v >> 96n === 0x20010db8n) return "IPv6 documentation (2001:db8::/32)";
  // IPv4-compatible (deprecated): ::a.b.c.d — anything under 2^32
  if (v >> 96n === 0n) {
    const reason = classifyIPv4(ipv4FromLow32(v)!);
    if (reason) return `IPv4-compatible ${reason}`;
  }
  return null;
}

function ipv4FromLow32(v: bigint): number[] | null {
  return [
    Number((v >> 24n) & 0xffn),
    Number((v >> 16n) & 0xffn),
    Number((v >> 8n) & 0xffn),
    Number(v & 0xffn),
  ];
}

function ipv4FromBits(v: bigint, shift: bigint): number[] | null {
  const low = v >> shift;
  return [
    Number((low >> 24n) & 0xffn),
    Number((low >> 16n) & 0xffn),
    Number((low >> 8n) & 0xffn),
    Number(low & 0xffn),
  ];
}

/**
 * Synchronous literal-IP check. Returns a rejection reason when the hostname
 * is a disallowed literal IP address, or null when it is a public literal IP
 * or a name (names must be resolved and checked with validateResolvedRecords).
 */
export function checkLiteralHost(hostname: string): string | null {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const v4 = parseIPv4(bare);
  if (v4) return classifyIPv4(v4);
  const v6 = parseIPv6(bare);
  if (v6 !== null) return classifyIPv6(v6);
  return null;
}

/**
 * Validates DNS-resolved A/AAAA records. Returns a rejection reason when ANY
 * record points at a non-public address (an attacker-controlled zone can
 * return mixed records to slip one past), or null when all records are public.
 * Empty/absent record sets pass — the outbound fetch will fail on its own.
 */
export function validateResolvedRecords(
  aRecords: string[],
  aaaaRecords: string[],
): string | null {
  for (const record of aRecords) {
    const v4 = parseIPv4(record);
    if (v4) {
      const reason = classifyIPv4(v4);
      if (reason) return `hostname resolves to ${reason}: ${record}`;
    }
  }
  for (const record of aaaaRecords) {
    const v6 = parseIPv6(record);
    if (v6 !== null) {
      const reason = classifyIPv6(v6);
      if (reason) return `hostname resolves to ${reason}: ${record}`;
    }
  }
  return null;
}
