import { assertEquals, assertMatch } from "@std/assert";
import { Hono } from "@hono/hono";
import { requestLogger } from "../../src/middleware/logger.ts";

Deno.test("requestLogger: omits query data while preserving encoded path and response context", async () => {
  const app = new Hono();
  app.use("*", requestLogger);
  app.get("*", (ctx) => ctx.text("teapot", 418, { "X-Reason": "Short and stout" }));

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

  try {
    const response = await app.fetch(
      new Request("http://localhost/caf%C3%A9/%2fitem?private_token_name=super_secret_value"),
    );

    assertEquals(response.status, 418);
    assertEquals(logs.length, 2);
    assertEquals(logs[0], "--> GET /caf%C3%A9/%2fitem");
    assertMatch(logs[1], /^<-- GET \/caf%C3%A9\/%2fitem 418 (?:\d+ms|\d+s) {2}Short and stout$/);

    for (const line of logs) {
      assertEquals(line.includes("private_token_name"), false);
      assertEquals(line.includes("super_secret_value"), false);
    }

    await response.body?.cancel();
  } finally {
    console.log = originalLog;
  }
});
