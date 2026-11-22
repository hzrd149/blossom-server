import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import { parseCidr } from "../../src/policy/cidr.ts";
import { clientIpMiddleware, getClientIp, resolveClientIp } from "../../src/middleware/client-ip.ts";

const trusted = [parseCidr("10.0.0.0/8")!, parseCidr("::1")!];

Deno.test("untrusted peers cannot spoof their address with forwarding headers", () => {
  assertEquals(resolveClientIp("198.51.100.4", "1.2.3.4", "x-forwarded-for", trusted), "198.51.100.4");
  assertEquals(resolveClientIp("198.51.100.4", "1.2.3.4", "x-forwarded-for", []), "198.51.100.4");
});

Deno.test("X-Forwarded-For is walked right to left past trusted hops", () => {
  assertEquals(resolveClientIp("10.0.0.2", "6.6.6.6, 203.0.113.5, 10.0.0.9", "x-forwarded-for", trusted), "203.0.113.5");
  // Every hop trusted: the left-most is the best available answer.
  assertEquals(resolveClientIp("10.0.0.2", "10.1.1.1, 10.0.0.9", "x-forwarded-for", trusted), "10.1.1.1");
  // A malformed hop stops the walk; the last good hop to its right is used.
  assertEquals(resolveClientIp("10.0.0.2", "6.6.6.6, garbage, 10.0.0.9", "x-forwarded-for", trusted), "10.0.0.9");
});

Deno.test("single-value and RFC 7239 headers are honoured from trusted proxies", () => {
  assertEquals(resolveClientIp("::1", "2001:db8::5", "x-real-ip", trusted), "2001:db8::5");
  assertEquals(resolveClientIp("::1", "not-an-ip", "cf-connecting-ip", trusted), "::1");
  assertEquals(
    resolveClientIp("10.0.0.2", 'for=192.0.2.60;proto=http, for="[2001:db8::7]:4711"', "forwarded", trusted),
    "2001:db8::7",
  );
  assertEquals(resolveClientIp("10.0.0.2", "for=192.0.2.60:8080", "forwarded", trusted), "192.0.2.60");
});

Deno.test("middleware tolerates missing connection info and reads remoteAddr when present", async () => {
  const app = new Hono();
  app.use("*", clientIpMiddleware({ trustedProxies: ["127.0.0.1"], clientIpHeader: "x-forwarded-for" }));
  app.get("/", (c) => c.text(getClientIp(c) ?? "none"));

  assertEquals(await (await app.fetch(new Request("http://localhost/"))).text(), "none");
  const env = { remoteAddr: { hostname: "127.0.0.1", port: 1234, transport: "tcp" } };
  const forwarded = new Request("http://localhost/", { headers: { "X-Forwarded-For": "203.0.113.1" } });
  assertEquals(await (await app.fetch(forwarded, env)).text(), "203.0.113.1");
});
