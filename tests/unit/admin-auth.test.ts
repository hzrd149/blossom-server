import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { adminAuth } from "../../src/admin/server/middleware/auth.ts";
import { ConfigSchema } from "../../src/config/schema.ts";
import { clientIpMiddleware } from "../../src/middleware/client-ip.ts";

const good = `Basic ${btoa("admin:secret")}`;
const bad = `Basic ${btoa("admin:wrong")}`;

function setup(maxEntries = 10_000) {
  let time = 0;
  let handled = 0;
  const app = new Hono();
  const config = ConfigSchema.parse({ dashboard: { enabled: true, username: "admin", password: "secret" } });
  app.use("*", clientIpMiddleware({ trustedProxies: ["10.0.0.0/8"], clientIpHeader: "x-forwarded-for" }));
  app.use("/admin/*", adminAuth(config, { now: () => time, maxEntries }));
  app.all("/admin/downstream", () => {
    throw new HTTPException(401);
  });
  app.all("*", (c) => {
    handled++;
    return c.text("ok");
  });
  const request = (authorization: string | null = bad, peer: string | null = "192.0.2.1", forwarded?: string, path = "/admin/api") => {
    const headers = new Headers();
    if (authorization !== null) headers.set("Authorization", authorization);
    if (forwarded) headers.set("X-Forwarded-For", forwarded);
    return app.fetch(
      new Request(`http://localhost${path}`, { headers }),
      peer ? { remoteAddr: { hostname: peer, port: 1234, transport: "tcp" } } : undefined,
    );
  };
  return { app, request, advance: (ms: number) => time += ms, handled: () => handled };
}

Deno.test("admin auth challenges, exponentially backs off, caps delay, and expires failures", async () => {
  const s = setup();
  for (let i = 0; i < 8; i++) {
    const response = await s.request(null);
    assertEquals(response.status, 401);
    assertEquals(response.headers.get("www-authenticate")?.startsWith("Basic"), true);
    assertEquals(response.headers.get("cache-control"), "no-store");
  }
  for (let i = 0; i < 5; i++) assertEquals((await s.request()).status, 401);
  for (const seconds of [1, 2, 4, 8, 16, 32, 60, 60]) {
    const blocked = await s.request(good);
    assertEquals(blocked.status, 429);
    assertEquals(blocked.headers.get("retry-after"), String(seconds));
    assertEquals(blocked.headers.get("cache-control"), "no-store");
    assertEquals(blocked.headers.has("x-reason"), false);
    assertEquals(s.handled(), 0);
    // Rejected requests do not extend the cooldown.
    s.advance(seconds * 1000);
    assertEquals((await s.request()).status, 401);
  }
  s.advance(15 * 60_000);
  assertEquals((await s.request()).status, 401);
  assertEquals((await s.request(good)).status, 200);
});

Deno.test("admin auth success resets failures and downstream 401s do not count", async () => {
  const s = setup();
  for (let i = 0; i < 4; i++) assertEquals((await s.request()).status, 401);
  assertEquals((await s.request(good)).status, 200);
  for (let i = 0; i < 4; i++) assertEquals((await s.request()).status, 401);
  assertEquals((await s.request(good)).status, 200);
  for (let i = 0; i < 8; i++) assertEquals((await s.request(good, "192.0.2.1", undefined, "/admin/downstream")).status, 401);
  assertEquals((await s.request(good)).status, 200);
});

Deno.test("admin throttling uses trusted proxy resolution, isolates clients, and tolerates missing peers", async () => {
  const s = setup();
  for (let i = 0; i < 5; i++) assertEquals((await s.request(bad, "192.0.2.1", `203.0.113.${i}`)).status, 401);
  assertEquals((await s.request(bad, "192.0.2.1", "203.0.113.99")).status, 429);
  assertEquals((await s.request(good, "192.0.2.2")).status, 200);
  assertEquals((await s.request(null, "192.0.2.1", undefined, "/public")).status, 200);
  for (let i = 0; i < 5; i++) assertEquals((await s.request(bad, "10.0.0.1", "203.0.113.1")).status, 401);
  assertEquals((await s.request(good, "10.0.0.1", "203.0.113.1")).status, 429);
  assertEquals((await s.request(good, "10.0.0.1", "203.0.113.2")).status, 200);
  for (let i = 0; i < 5; i++) assertEquals((await s.request("malformed", null)).status, 401);
  assertEquals((await s.request(good, null, "203.0.113.3")).status, 429);
});

Deno.test("admin failure tracking is bounded and evicts the oldest address", async () => {
  const s = setup(2);
  for (let i = 0; i < 5; i++) assertEquals((await s.request(bad, "192.0.2.1")).status, 401);
  for (let i = 0; i < 5; i++) assertEquals((await s.request(bad, "192.0.2.2")).status, 401);
  assertEquals((await s.request(bad, "192.0.2.3")).status, 401);
  assertEquals((await s.request(good, "192.0.2.2")).status, 429);
  assertEquals((await s.request(good, "192.0.2.1")).status, 200);
});

Deno.test("admin auth cancels rejected streaming bodies before returning", async () => {
  const s = setup();
  for (const expected of [401, 401, 401, 401, 401, 429]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = await s.app.fetch(
      new Request("http://localhost/admin/api", {
        method: "POST",
        headers: { Authorization: bad },
        body,
      }),
    );
    assertEquals(response.status, expected);
    assertEquals(cancelled, true);
  }
  assertEquals(s.handled(), 0);
});
