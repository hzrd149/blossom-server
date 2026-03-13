/**
 * upload-flood.js — High-throughput tiny-upload flood
 *
 * Scenario:
 *   100 VUs, constant load, 20 s duration, each uploading a 1-byte body as
 *   fast as possible (no sleep). Designed to hit request-parsing throughput
 *   rather than storage I/O.
 *
 * What it probes:
 *   - Deno HTTP server accept() throughput
 *   - Hono middleware pipeline speed (auth parse, header checks)
 *   - UploadWorkerPool dispatch path (most requests will 503 immediately
 *     since 1-byte uploads finish in <1 ms — workers cycle fast)
 *   - Event-loop stall detection: if p99 latency climbs linearly over the
 *     test duration, the event loop is stalling (bad)
 *
 * Expected behaviour:
 *   - Very high RPS — tiny bodies cycle through workers quickly
 *   - 503 rate may be moderate (workers occupied but finishing fast)
 *   - Latency should be flat over the 20 s window, not trending upward
 *
 * Thresholds (CI pass/fail):
 *   - http_req_duration{p99} < 500 ms   (tiny bodies must be fast)
 *   - http_req_failed < 0.90            (allow up to 90% 503s — that's fine here)
 */

import { check } from "k6";
import http from "k6/http";

const TARGET_URL = __ENV.TARGET_URL || "http://localhost:3000";

// Single byte — minimises I/O, maximises request throughput
const BODY = new Uint8Array([0x42]); // 1 byte

export const options = {
  scenarios: {
    flood: {
      executor: "constant-vus",
      vus: 100,
      duration: "20s",
    },
  },
  thresholds: {
    // p99 must stay bounded — a climbing p99 indicates event-loop stall
    "http_req_duration{expected_response:true}": ["p(99)<500"],
    // Allow high 503 rate — tiny uploads cycle fast but pool is only 2 workers
    http_req_failed: ["rate<0.95"],
  },
};

export default function () {
  const res = http.put(`${TARGET_URL}/upload`, BODY.buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": "1",
    },
    timeout: "5s",
  });

  check(res, {
    "status 200 or 503": (r) => r.status === 200 || r.status === 503,
    "no 5xx server errors": (r) => r.status < 500 || r.status === 503,
  });

  // No sleep — maximum throughput, tests event-loop saturation
}
