import { assert, assertEquals } from "@std/assert";
import { formatIp, ipInRanges, normalizeIp, parseCidr, parseIp } from "../../src/policy/cidr.ts";

Deno.test("parseCidr normalises IPv4 ranges and clears host bits", () => {
  const range = parseCidr("10.1.2.3/8")!;
  assertEquals(range.cidr, "10.0.0.0/8");
  assert(ipInRanges(parseIp("10.255.0.1")!, [range]));
  assert(!ipInRanges(parseIp("11.0.0.1")!, [range]));
  assertEquals(parseCidr("192.0.2.7")!.cidr, "192.0.2.7/32");
});

Deno.test("IPv4 ranges match IPv4-mapped IPv6 spellings", () => {
  const range = parseCidr("203.0.113.0/24")!;
  assert(ipInRanges(parseIp("::ffff:203.0.113.9")!, [range]));
  assertEquals(normalizeIp("::ffff:203.0.113.9"), "203.0.113.9");
});

Deno.test("parseCidr handles IPv6 ranges and canonical formatting", () => {
  const range = parseCidr("2001:DB8::1/32")!;
  assertEquals(range.cidr, "2001:db8::/32");
  assert(ipInRanges(parseIp("2001:db8:ffff::1")!, [range]));
  assert(!ipInRanges(parseIp("2001:db9::1")!, [range]));
  assertEquals(formatIp(parseIp("2001:db8:0:0:1:0:0:1")!), "2001:db8::1:0:0:1");
  assertEquals(parseCidr("::/0")!.cidr, "::/0");
});

Deno.test("parseCidr rejects malformed input", () => {
  for (const input of ["", "10.0.0.0/33", "2001:db8::/129", "10.0.0/8", "10.0.0.0/8/1", "host.example", "10.0.0.0/-1"]) {
    assertEquals(parseCidr(input), null, input);
  }
});
