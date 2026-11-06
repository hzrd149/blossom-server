import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Hono } from "@hono/hono";
import { HttpMetrics } from "../../src/metrics/http.ts";
import { OperationMetrics } from "../../src/metrics/operations.ts";
import { instrumentStorage } from "../../src/metrics/storage.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { S3Storage } from "../../src/storage/s3.ts";
import { readRange } from "../../src/routes/blobs.ts";

Deno.test("fallback Range remains pull-driven and cancels underlying read at range end", async () => {
  let pulls = 0;
  let cancelled = false;
  const local = new LocalStorage("/unused");
  const fallback = new Proxy(local, {
    get(target, property) {
      if (property === "readRange") return undefined;
      if (property === "read") {
        return () =>
          Promise.resolve(
            new ReadableStream<Uint8Array>({
              pull(c) {
                pulls++;
                c.enqueue(new Uint8Array([1, 2, 3, 4]));
              },
              cancel() {
                cancelled = true;
              },
            }, { highWaterMark: 0 }),
          );
      }
      return Reflect.get(target, property);
    },
  });
  const metrics = new OperationMetrics();
  const storage = instrumentStorage(fallback, metrics, "local");
  assertEquals(storage.readRange, undefined);
  const stream = (await readRange(storage, "hash", "", 1, 2))!;
  assertEquals(pulls, 0);
  assertEquals(new Uint8Array(await new Response(stream).arrayBuffer()), new Uint8Array([2, 3]));
  assertEquals(pulls, 1);
  assertEquals(cancelled, true);
  assertStringIncludes(metrics.render(), 'operation="read",outcome="cancelled"} 1');
});

Deno.test("S3 caught errors distinguish explicit missing keys from backend errors", async () => {
  let status = 404;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, () =>
    new Response(
      `<Error><Code>${status === 404 ? "NoSuchKey" : "AccessDenied"}</Code><Message>private</Message></Error>`,
      { status },
    ));
  const seen: unknown[] = [];
  const storage = new S3Storage({
    endpoint: `http://127.0.0.1:${server.addr.port}`,
    bucket: "test-bucket",
    accessKey: "test",
    secretKey: "test",
    tmpDir: "/unused",
    onReadError: (operation, missing) => {
      seen.push([operation, missing]);
    },
  });
  try {
    assertEquals(await storage.read("hash", ""), null);
    status = 403;
    assertEquals(await storage.read("hash", ""), null);
    assertEquals(await storage.has("hash", ""), false);
    assertEquals(seen, [["read", true], ["read", false], ["has", false]]);
    await assertRejects(() => storage.remove("hash", ""));
    status = 404;
    assertEquals(await storage.remove("hash", ""), false);
  } finally {
    await server.shutdown();
  }
});

Deno.test("real HTTP disconnect cancels observed download", async () => {
  const metrics = new HttpMetrics("test");
  let notifyCancel!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    notifyCancel = resolve;
  });
  const app = new Hono();
  app.use("*", metrics.middleware);
  app.get("*", () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(1024));
        },
        cancel() {
          notifyCancel();
        },
      }),
    ));
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, app.fetch);
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await fetch(`http://127.0.0.1:${server.addr.port}/${"a".repeat(64)}`, { signal: abort.signal });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    abort.abort();
    await Promise.race([
      cancelled,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("disconnect did not cancel stream")), 3000);
      }),
    ]);
    assertStringIncludes(metrics.render(), 'blossom_download_active{response="full",mime_group="other"} 0');
    assertStringIncludes(metrics.render(), 'outcome="cancelled"} 1');
  } finally {
    clearTimeout(timer);
    abort.abort();
    await server.shutdown();
  }
});

Deno.test("stream observer preserves demand, bytes, completion and terminal gauge", async () => {
  const metrics = new OperationMetrics();
  let pulls = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      c.enqueue(new Uint8Array([1, 2, 3]));
      c.close();
    },
  }, { highWaterMark: 0 });
  const stream = metrics.stream(source, "download", 'response="full"');
  assertEquals(pulls, 0);
  assertEquals(new Uint8Array(await new Response(stream).arrayBuffer()), new Uint8Array([1, 2, 3]));
  assertStringIncludes(metrics.render(), 'blossom_download_bytes_total{response="full"} 3');
  assertStringIncludes(metrics.render(), 'blossom_download_active{response="full"} 0');
  assertStringIncludes(metrics.render(), 'outcome="completed"} 1');
});

Deno.test("cancel during pending read propagates reason and records exactly one outcome", async () => {
  const metrics = new OperationMetrics();
  let reason: unknown;
  const source = new ReadableStream<Uint8Array>({
    cancel(value) {
      reason = value;
    },
  });
  const reader = metrics.stream(source, "download", 'response="partial"').getReader();
  const pending = reader.read();
  await reader.cancel("disconnect");
  await pending;
  assertEquals(reason, "disconnect");
  assertStringIncludes(metrics.render(), 'blossom_download_active{response="partial"} 0');
  assertStringIncludes(metrics.render(), 'outcome="cancelled"} 1');
  assertEquals(metrics.render().includes('outcome="completed"'), false);
});

Deno.test("stream errors remain errors and release active gauge", async () => {
  const metrics = new OperationMetrics();
  const source = new ReadableStream<Uint8Array>({
    pull(c) {
      c.error(new Error("backend failure"));
    },
  });
  await assertRejects(() => new Response(metrics.stream(source, "storage_read", 'operation="read"')).text(), Error, "backend failure");
  assertStringIncludes(metrics.render(), 'blossom_storage_read_active{operation="read"} 0');
  assertStringIncludes(metrics.render(), 'outcome="error"} 1');
});

Deno.test("HTTP download metrics include only GET 200/206 bodies and preserve headers", async () => {
  for (const status of [200, 206, 304, 404, 416] as const) {
    const metrics = new HttpMetrics("test");
    const app = new Hono();
    app.use("*", metrics.middleware);
    app.get("*", () => new Response(status === 304 ? null : "abc", { status, headers: { "Content-Type": "video/mp4", "ETag": '"test"' } }));
    const response = await app.request(`/${"a".repeat(64)}`);
    assertEquals(response.status, status);
    assertEquals(response.headers.get("etag"), '"test"');
    await response.text();
    assertEquals(metrics.render().includes("blossom_download_bytes_total"), status === 200 || status === 206);
    const headMetrics = new HttpMetrics("test");
    const headApp = new Hono();
    headApp.use("*", headMetrics.middleware);
    headApp.get("*", () => new Response(null));
    await headApp.request(`/${"b".repeat(64)}`, { method: "HEAD" });
    assertEquals(headMetrics.render().includes("blossom_download_active"), false);
  }
});

Deno.test("storage instrumentation preserves adapter methods and records missing and failure", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const metrics = new OperationMetrics();
    const local = new LocalStorage(dir);
    const storage = instrumentStorage(local, metrics, "local");
    assertEquals(await storage.has("missing", ""), false);
    await assertRejects(() => storage.commitFile(`${dir}/absent`, "hash", ""));
    assertStringIncludes(metrics.render(), 'operation="has",outcome="empty"} 1');
    assertStringIncludes(metrics.render(), 'operation="commitFile",outcome="error"} 1');
    assertEquals(typeof storage.readRange, "function");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
