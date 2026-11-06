import { assertEquals, assertStringIncludes } from "@std/assert";
import { Hono } from "@hono/hono";
import { HttpMetrics } from "../../src/metrics/http.ts";
import { ConfigSchema } from "../../src/config/schema.ts";

Deno.test("metrics configuration defaults to disabled loopback listener", () => {
  assertEquals(ConfigSchema.parse({}).metrics, { enabled: false, host: "127.0.0.1", port: 3001, inventoryIntervalMs: 60000 });
  assertEquals(ConfigSchema.parse({ metrics: { enabled: true } }).metrics.enabled, true);
  assertEquals(ConfigSchema.safeParse({ metrics: { port: 0 } }).success, false);
});

Deno.test("metrics aggregate distinct identifiers and exclude query strings", async () => {
  const metrics = new HttpMetrics("test");
  const app = new Hono();
  app.use("*", metrics.middleware);
  app.get("*", (c) => c.text("missing", 404));
  for (let i = 0; i < 100; i++) {
    await app.request(`/${i.toString(16).padStart(64, "0")}?secret=credential`);
  }
  const text = metrics.render();
  assertStringIncludes(text, 'blossom_http_requests_total{route="blob",method="GET",status="404"} 100');
  assertEquals(text.includes("credential"), false);
  assertEquals(text.split("\n").filter((line) => line.startsWith("blossom_http_requests_total{")).length, 1);
  assertStringIncludes(text, 'le="+Inf"} 100');
  assertStringIncludes(text, "blossom_http_handlers_active 0");
});

Deno.test("metrics observe error status and release active handler gauge", async () => {
  const metrics = new HttpMetrics("test");
  const app = new Hono();
  app.use("*", metrics.middleware);
  app.onError((_error, c) => c.text("failed", 503));
  app.get("/upload", () => {
    throw new Error("private error");
  });
  assertEquals((await app.request("/upload")).status, 503);
  assertStringIncludes(metrics.render(), 'status="503"} 1');
  assertStringIncludes(metrics.render(), "blossom_http_handlers_active 0");
  assertEquals(metrics.render().includes("private error"), false);
});

Deno.test("handler measurement does not consume or await response streams", async () => {
  const metrics = new HttpMetrics("test");
  let pulled = false;
  const body = new ReadableStream({
    pull() {
      pulled = true;
    },
  }, { highWaterMark: 0 });
  const app = new Hono();
  app.use("*", metrics.middleware);
  app.get("/", () => new Response(body));
  const response = await app.request("/");
  assertEquals(pulled, false);
  assertStringIncludes(metrics.render(), "blossom_http_handlers_active 0");
  await response.body?.cancel();
});

Deno.test("private endpoint only serves metrics and does not instrument scrapes", async () => {
  const metrics = new HttpMetrics("test");
  const before = metrics.render();
  const response = metrics.fetch(new Request("http://localhost/metrics"));
  assertEquals(response.status, 200);
  assertStringIncludes(response.headers.get("content-type")!, "version=0.0.4");
  assertEquals(await response.text(), before);
  assertEquals(metrics.render(), before);
  assertEquals(metrics.fetch(new Request("http://localhost/admin")).status, 404);
  assertEquals(metrics.fetch(new Request("http://localhost/metrics", { method: "POST" })).status, 405);
  assertEquals(await metrics.fetch(new Request("http://localhost/metrics", { method: "HEAD" })).text(), "");
});
