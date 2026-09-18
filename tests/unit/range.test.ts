/**
 * Unit tests for range request parsing and byteLimitTransform.
 *
 * parseRange() is exported from blobs.ts — these tests cover all RFC 9110
 * single-range forms as well as rejected/unsatisfiable inputs.
 *
 * byteLimitTransform() is tested here to confirm it correctly truncates
 * streams to exact byte counts across chunk-boundary scenarios.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { parseRange } from "../../src/routes/blobs.ts";
import {
  BYTE_LIMIT_ERROR,
  byteCapGuard,
  byteLimitTransform,
} from "../../src/utils/streams.ts";

// ---------------------------------------------------------------------------
// parseRange — RFC 9110 single-range forms
// ---------------------------------------------------------------------------

Deno.test("parseRange: explicit start-end range", () => {
  assertEquals(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
});

Deno.test("parseRange: single byte range (bytes=0-0)", () => {
  assertEquals(parseRange("bytes=0-0", 1000), { start: 0, end: 0 });
});

Deno.test("parseRange: last byte (bytes=999-999)", () => {
  assertEquals(parseRange("bytes=999-999", 1000), { start: 999, end: 999 });
});

Deno.test("parseRange: open-end range (bytes=500-)", () => {
  assertEquals(parseRange("bytes=500-", 1000), { start: 500, end: 999 });
});

Deno.test("parseRange: open-end range starting at 0 (bytes=0-)", () => {
  assertEquals(parseRange("bytes=0-", 1000), { start: 0, end: 999 });
});

Deno.test("parseRange: suffix range (bytes=-100)", () => {
  assertEquals(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
});

Deno.test("parseRange: suffix range equal to file size (bytes=-1000)", () => {
  assertEquals(parseRange("bytes=-1000", 1000), { start: 0, end: 999 });
});

// ---------------------------------------------------------------------------
// parseRange — RFC 9110 §14.1.2 clamping
// ---------------------------------------------------------------------------

Deno.test("parseRange: end past EOF is clamped to the last byte", () => {
  assertEquals(parseRange("bytes=0-1000", 1000), { start: 0, end: 999 });
});

Deno.test("parseRange: end far past EOF is clamped to the last byte", () => {
  assertEquals(parseRange("bytes=500-999999", 1000), { start: 500, end: 999 });
});

Deno.test("parseRange: nginx-style aligned slice past EOF is clamped", () => {
  // `slice 1m` asks for bytes=1048576-2097151 on a 1111411-byte file: the
  // start is inside the file, so the range is satisfiable and clamps to EOF.
  assertEquals(parseRange("bytes=1048576-2097151", 1111411), {
    start: 1048576,
    end: 1111410,
  });
});

Deno.test("parseRange: suffix longer than the file selects the whole file", () => {
  assertEquals(parseRange("bytes=-5000", 1000), { start: 0, end: 999 });
});

// ---------------------------------------------------------------------------
// parseRange — unsatisfiable / invalid inputs → null
// ---------------------------------------------------------------------------

Deno.test("parseRange: start > end is unsatisfiable", () => {
  assertEquals(parseRange("bytes=100-99", 1000), null);
});

Deno.test("parseRange: start equals totalSize is unsatisfiable", () => {
  assertEquals(parseRange("bytes=1000-1000", 1000), null);
});

Deno.test("parseRange: start past totalSize is unsatisfiable", () => {
  assertEquals(parseRange("bytes=1500-2000", 1000), null);
});

Deno.test("parseRange: open-end range starting past EOF is unsatisfiable", () => {
  assertEquals(parseRange("bytes=1000-", 1000), null);
});

Deno.test("parseRange: suffix range on a 0-byte file is unsatisfiable", () => {
  assertEquals(parseRange("bytes=-5", 0), null);
});

Deno.test("parseRange: suffix of 0 (bytes=-0) is unsatisfiable", () => {
  // start = 1000 - 0 = 1000, end = 999 → start > end → null
  assertEquals(parseRange("bytes=-0", 1000), null);
});

Deno.test("parseRange: open-end on 0-byte file is unsatisfiable", () => {
  // start=0, end=-1 → start > end → null
  assertEquals(parseRange("bytes=0-", 0), null);
});

Deno.test("parseRange: multi-range is rejected (not supported)", () => {
  assertEquals(parseRange("bytes=0-100, 200-300", 1000), null);
});

Deno.test("parseRange: malformed header returns null", () => {
  assertEquals(parseRange("bytes=foobar", 1000), null);
});

Deno.test("parseRange: wrong unit returns null", () => {
  assertEquals(parseRange("tokens=0-100", 1000), null);
});

Deno.test("parseRange: empty string returns null", () => {
  assertEquals(parseRange("", 1000), null);
});

Deno.test("parseRange: both values missing (bytes=-) returns null", () => {
  assertEquals(parseRange("bytes=-", 1000), null);
});

// ---------------------------------------------------------------------------
// byteLimitTransform — exact byte counting across chunk boundaries
// ---------------------------------------------------------------------------

/** Collect all chunks from a ReadableStream into a single Uint8Array. */
async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Create a ReadableStream from a Uint8Array, optionally split into chunks of `chunkSize`. */
function makeStream(
  data: Uint8Array,
  chunkSize = data.byteLength,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < data.byteLength; i += chunkSize) {
        controller.enqueue(
          data.subarray(i, Math.min(i + chunkSize, data.byteLength)),
        );
      }
      controller.close();
    },
  });
}

Deno.test("byteLimitTransform: limit equals stream length — all bytes pass through", async () => {
  const data = new Uint8Array([0, 1, 2, 3, 4]);
  const result = await collect(
    makeStream(data).pipeThrough(byteLimitTransform(5)),
  );
  assertEquals(result, data);
});

Deno.test("byteLimitTransform: limit less than stream — truncates to exact count", async () => {
  const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const result = await collect(
    makeStream(data).pipeThrough(byteLimitTransform(4)),
  );
  assertEquals(result, new Uint8Array([0, 1, 2, 3]));
});

Deno.test("byteLimitTransform: limit of 1 passes exactly one byte", async () => {
  const data = new Uint8Array([42, 99, 100]);
  const result = await collect(
    makeStream(data).pipeThrough(byteLimitTransform(1)),
  );
  assertEquals(result, new Uint8Array([42]));
});

Deno.test("byteLimitTransform: limit of 0 produces empty stream", async () => {
  const data = new Uint8Array([1, 2, 3]);
  const result = await collect(
    makeStream(data).pipeThrough(byteLimitTransform(0)),
  );
  assertEquals(result.byteLength, 0);
});

Deno.test("byteLimitTransform: limit spanning multiple small chunks", async () => {
  // 10 bytes total, streamed 2 bytes at a time, limit is 7
  const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const result = await collect(
    makeStream(data, 2).pipeThrough(byteLimitTransform(7)),
  );
  assertEquals(result, new Uint8Array([0, 1, 2, 3, 4, 5, 6]));
});

Deno.test("byteLimitTransform: cut falls in the middle of a chunk", async () => {
  // 10 bytes streamed in one chunk, limit is 3 — cut is in the middle of the chunk
  const data = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  const result = await collect(
    makeStream(data, 10).pipeThrough(byteLimitTransform(3)),
  );
  assertEquals(result, new Uint8Array([10, 20, 30]));
});

Deno.test("byteLimitTransform: limit larger than stream — all bytes pass through", async () => {
  const data = new Uint8Array([1, 2, 3]);
  const result = await collect(
    makeStream(data).pipeThrough(byteLimitTransform(100)),
  );
  assertEquals(result, data);
});

// ---------------------------------------------------------------------------
// byteCapGuard — stream-side upload size cap (errors, never truncates)
// ---------------------------------------------------------------------------

function cappedStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function countBytes(stream: ReadableStream<Uint8Array>): Promise<number> {
  let total = 0;
  for await (const chunk of stream) total += chunk.byteLength;
  return total;
}

Deno.test("byteCapGuard: stream under the limit passes through intact", async () => {
  const out = cappedStream(new Uint8Array(40), new Uint8Array(40))
    .pipeThrough(byteCapGuard(100));
  assertEquals(await countBytes(out), 80);
});

Deno.test("byteCapGuard: stream exactly at the limit passes (declared size is legitimate)", async () => {
  const out = cappedStream(new Uint8Array(60), new Uint8Array(40))
    .pipeThrough(byteCapGuard(100));
  assertEquals(await countBytes(out), 100);
});

Deno.test("byteCapGuard: stream exceeding the limit errors with the sentinel", async () => {
  // Simulates a lying Content-Length: declared 100, actually streams 120.
  const out = cappedStream(new Uint8Array(60), new Uint8Array(60))
    .pipeThrough(byteCapGuard(100));
  await assertRejects(() => countBytes(out), Error, BYTE_LIMIT_ERROR);
});

Deno.test("byteCapGuard: single oversized chunk errors immediately", async () => {
  const out = cappedStream(new Uint8Array(1000)).pipeThrough(byteCapGuard(100));
  await assertRejects(() => countBytes(out), Error, BYTE_LIMIT_ERROR);
});

Deno.test("byteCapGuard: limit 0 rejects any non-empty body", async () => {
  const out = cappedStream(new Uint8Array(1)).pipeThrough(byteCapGuard(0));
  await assertRejects(() => countBytes(out), Error, BYTE_LIMIT_ERROR);
});
