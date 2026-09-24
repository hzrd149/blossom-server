import { assertEquals } from "@std/assert";
import { checkLiteralHost, parseIPv6, validateResolvedRecords } from "../../src/utils/ip-guard.ts";

// ---------------------------------------------------------------------------
// IPv4 literals — every non-public range must be rejected
// ---------------------------------------------------------------------------

const REJECTED_IPV4 = [
  "0.0.0.0", // unspecified
  "0.1.2.3", // 0.0.0.0/8
  "10.1.2.3", // RFC-1918
  "100.64.0.1", // CGNAT lower bound
  "100.127.255.255", // CGNAT upper bound
  "127.0.0.1", // loopback
  "127.255.255.255", // loopback /8
  "169.254.169.254", // link-local (cloud metadata)
  "172.16.0.1", // RFC-1918 lower bound
  "172.31.255.255", // RFC-1918 upper bound
  "192.0.0.1", // IANA special
  "192.0.2.1", // TEST-NET-1
  "192.168.1.1", // RFC-1918
  "192.88.99.1", // deprecated 6to4 relay anycast
  "198.18.0.1", // benchmarking
  "198.51.100.1", // TEST-NET-2
  "203.0.113.1", // TEST-NET-3
  "224.0.0.1", // multicast
  "239.255.255.255", // multicast upper bound
  "240.0.0.1", // reserved
  "255.255.255.255", // broadcast (inside 240/4)
];

const ALLOWED_IPV4 = [
  "1.1.1.1",
  "8.8.8.8",
  "93.184.216.34",
  "172.32.0.1", // just outside 172.16/12
  "100.128.0.1", // just outside CGNAT
  "172.15.255.255", // just below 172.16/12
];

for (const host of REJECTED_IPV4) {
  Deno.test(`literal IPv4 rejected: ${host}`, () => {
    assertEquals(checkLiteralHost(host) !== null, true);
  });
}
for (const host of ALLOWED_IPV4) {
  Deno.test(`literal IPv4 allowed: ${host}`, () => {
    assertEquals(checkLiteralHost(host), null);
  });
}

// ---------------------------------------------------------------------------
// IPv6 literals — every encoding of internal targets must be rejected
// ---------------------------------------------------------------------------

const REJECTED_IPV6 = [
  "::", // unspecified
  "::1", // loopback
  "[::1]", // bracketed (as URL.hostname presents it)
  "0:0:0:0:0:0:0:1", // expanded loopback — MISSED by the old guard
  "0000:0000:0000:0000:0000:0000:0000:0001", // fully expanded loopback
  "::127.0.0.1", // IPv4-compatible loopback
  "::10.0.0.1", // IPv4-compatible RFC-1918
  "::ffff:127.0.0.1", // IPv4-mapped loopback — MISSED by the old guard
  "::ffff:7f00:1", // IPv4-mapped loopback, hex spelling
  "[::ffff:169.254.169.254]", // IPv4-mapped metadata endpoint
  "::ffff:10.0.0.1", // IPv4-mapped RFC-1918
  "fd00::1", // ULA — MISSED by the old guard
  "fd12:3456:789a:bcde:f012:3456:789a:bcde", // ULA full form
  "fc00::1", // ULA lower edge
  "fe80::1", // link-local — MISSED by the old guard
  "febf:ffff::1", // link-local upper edge
  "fec0::1", // deprecated site-local
  "feff:ffff::1", // deprecated site-local upper edge
  "ff02::1", // multicast
  "100::1", // discard-only
  "64:ff9b:1::1", // local-use translation prefix
  "2001:2::1", // benchmarking
  "2001:10::1", // ORCHIDv1
  "2001:20::1", // ORCHIDv2
  "64:ff9b::127.0.0.1", // NAT64 embedding loopback
  "64:ff9b::7f00:1", // NAT64 loopback, hex spelling
  "2002:7f00:1::", // 6to4 embedding 127.0.0.1
  "2002:a9fe:1::", // 6to4 embedding 169.254.0.1 (metadata range)
  "2001:0:1234::1", // Teredo
  "2001:db8::1", // documentation
  "3fff::1", // documentation
  "5f00::1", // segment-routing SIDs
];

const ALLOWED_IPV6 = [
  "2606:4700:4700::1111", // Cloudflare DNS
  "2a00:1450:4001:81b::200e", // public global unicast
  "::ffff:8.8.8.8", // IPv4-mapped PUBLIC address is fine
  "64:ff9b::8.8.8.8", // NAT64 of a public address is fine
  "2002:101:101::", // 6to4 of 1.1.1.1 (hex spelling) is fine
];

for (const host of REJECTED_IPV6) {
  Deno.test(`literal IPv6 rejected: ${host}`, () => {
    assertEquals(checkLiteralHost(host) !== null, true);
  });
}
for (const host of ALLOWED_IPV6) {
  Deno.test(`literal IPv6 allowed: ${host}`, () => {
    assertEquals(checkLiteralHost(host), null);
  });
}

// ---------------------------------------------------------------------------
// parseIPv6 — canonical values and malformed inputs
// ---------------------------------------------------------------------------

Deno.test("parseIPv6: canonical values", () => {
  assertEquals(parseIPv6("::"), 0n);
  assertEquals(parseIPv6("::1"), 1n);
  assertEquals(
    parseIPv6("1:2:3:4:5:6:7:8"),
    0x00010002000300040005000600070008n,
  );
  assertEquals(
    parseIPv6("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
    (1n << 128n) - 1n,
  );
  // ::ffff:1.2.3.4 === 0x0000...ffff01020304
  assertEquals(
    parseIPv6("::ffff:1.2.3.4"),
    0xffff01020304n,
  );
});

Deno.test("parseIPv6: malformed inputs return null", () => {
  assertEquals(parseIPv6(":::1"), null); // triple colon
  assertEquals(parseIPv6("1::2::3"), null); // two "::"
  assertEquals(parseIPv6("1:2:3"), null); // too few groups
  assertEquals(parseIPv6("1:2:3:4:5:6:7:8:9"), null); // too many groups
  assertEquals(parseIPv6("1:2:3:4:5:6:7::8"), null); // "::" must compress at least one group
  assertEquals(parseIPv6("gg::1"), null); // non-hex
  assertEquals(parseIPv6("1.2.3.4"), null); // IPv4 is not IPv6
  assertEquals(parseIPv6("::ffff:999.1.1.1"), null); // invalid embedded IPv4
  assertEquals(parseIPv6("example.com"), null);
});

Deno.test("parseIPv6: zone index stripped", () => {
  assertEquals(parseIPv6("fe80::1%eth0"), parseIPv6("fe80::1"));
});

// ---------------------------------------------------------------------------
// validateResolvedRecords — DNS resolve-then-validate
// ---------------------------------------------------------------------------

Deno.test("validateResolvedRecords: all public records pass", () => {
  assertEquals(
    validateResolvedRecords(["1.1.1.1", "8.8.8.8"], ["2606:4700::1111"]),
    null,
  );
});

Deno.test("validateResolvedRecords: any private A record rejects (mixed-record attack)", () => {
  assertEquals(
    validateResolvedRecords(["1.1.1.1", "127.0.0.1"], []) !== null,
    true,
  );
});

Deno.test("validateResolvedRecords: private AAAA record rejects", () => {
  assertEquals(
    validateResolvedRecords([], ["::ffff:169.254.169.254"]) !== null,
    true,
  );
  assertEquals(validateResolvedRecords([], ["fd00::5"]) !== null, true);
});

Deno.test("validateResolvedRecords: empty record sets pass", () => {
  assertEquals(validateResolvedRecords([], []), null);
});

Deno.test("validateResolvedRecords: malformed resolver output rejects", () => {
  assertEquals(validateResolvedRecords(["not-an-ip"], []) !== null, true);
  assertEquals(validateResolvedRecords([], ["also-not-an-ip"]) !== null, true);
});
