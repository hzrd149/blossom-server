/**
 * upload-concurrent.js — Concurrent upload stress test
 *
 * Scenario:
 *   Ramps from 1 → 50 virtual users (VUs) over 30 s, holds at 50 for 30 s,
 *   then ramps back down. Each VU continuously submits a 1 MB random body via
 *   PUT /upload.
 *
 * What it probes:
 *   - UploadWorkerPool exhaustion (503 Service Unavailable when pool full)
 *   - SQLite write contention via the DbBridge MessageChannel proxy
 *   - Deno event-loop throughput under concurrent async I/O
 *   - Memory growth under sustained concurrent write load
 *
 * Expected behaviour (with workers: 2):
 *   - Once >2 uploads are in-flight, additional requests receive 503 immediately
 *   - 503 rate should be high but STABLE — not climbing over time (no leak)
 *   - Server should not crash; all 503s should be deliberate rejections
 *
 * Thresholds (CI pass/fail):
 *   - http_req_failed < 80%   (i.e., at least 20% succeed — pool not permanently stuck)
 *   - http_req_duration{p95} < 5000 ms  (tail latency bounded)
 *   - successful uploads have status 200
 */

import { check, sleep } from "k6";
import http from "k6/http";

const TARGET_URL = __ENV.TARGET_URL || "http://localhost:3000";

// 1 MB of random-ish data — k6 doesn't have crypto, so we use a fixed
// pattern that is large enough to occupy a worker for a meaningful duration.
const BODY_SIZE = 1 * 1024 * 1024; // 1 MB
const body = new Uint8Array(BODY_SIZE);
for (let i = 0; i < BODY_SIZE; i++) {
  body[i] = i & 0xff;
}

export const options = {
  scenarios: {
    ramp_concurrent: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 50 }, // ramp up to 50 concurrent
        { duration: "30s", target: 50 }, // hold at 50
        { duration: "10s", target: 0 },  // ramp down
      ],
    },
  },
  thresholds: {
    // Server must not get permanently stuck — at least 20% of requests succeed
    http_req_failed: ["rate<0.80"],
    // p95 tail latency must stay under 5 s (503s are sub-10ms; success ~1-3s)
    "http_req_duration{expected_response:true}": ["p(95)<5000"],
  },
};

export default function () {
  const res = http.put(`${TARGET_URL}/upload`, body.buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(BODY_SIZE),
    },
    timeout: "10s",
  });

  check(res, {
    "status is 200 or 503": (r) => r.status === 200 || r.status === 503,
    "no unexpected errors": (r) => r.status !== 500 && r.status !== 502,
  });

  // Small think time — prevents degenerate tight-loop behaviour that would
  // make the test more of a CPU benchmark than a concurrency stress test.
  sleep(0.1);
}
