/**
 * upload-large.js — Large-body upload pressure test
 *
 * Scenario:
 *   5 VUs, each uploading an 8 MB body back-to-back for 60 s.
 *   8 MB is 80% of the 10 MB maxSize configured in config.stress.yml.
 *
 * What it probes:
 *   - Disk I/O throughput (writes to the stress-data Docker volume)
 *   - Worker occupation duration — 8 MB bodies hold a worker for much longer
 *     than 1 MB bodies, so pool exhaustion is sustained
 *   - Memory behaviour under concurrent large streaming writes
 *   - SQLite write path: large uploads produce one INSERT per completion;
 *     checks that the DbBridge handles the slower write cadence correctly
 *   - Whether large uploads starve concurrent small uploads (run this
 *     alongside upload-concurrent manually to observe interaction)
 *
 * Expected behaviour (with workers: 2):
 *   - At most 2 uploads in-flight simultaneously
 *   - VUs 3–5 receive 503 and retry on the next iteration
 *   - 503 rate should be ~60% (3 out of 5 VUs rejected each round)
 *   - Upload duration per successful request: dominated by disk I/O
 *   - No OOM: 5 × 8 MB = 40 MB peak in-flight, well within 512 MB limit
 *
 * Thresholds (CI pass/fail):
 *   - http_req_failed < 0.75   (at least 25% succeed — pool not stuck)
 *   - http_req_duration{p95,expected_response:true} < 30000 ms
 *     (8 MB upload to a volume should complete in under 30 s)
 */

import { check, sleep } from "k6";
import http from "k6/http";

const TARGET_URL = __ENV.TARGET_URL || "http://localhost:3000";

// 8 MB body — large enough to hold a worker busy for a meaningful duration
const BODY_SIZE = 8 * 1024 * 1024; // 8 MB
const body = new Uint8Array(BODY_SIZE);
// Fill with a repeating pattern — cheap to generate, not compressible enough
// to matter at this level (Docker volumes don't compress streams).
for (let i = 0; i < BODY_SIZE; i++) {
  body[i] = (i * 37 + 13) & 0xff;
}

export const options = {
  scenarios: {
    large_uploads: {
      executor: "constant-vus",
      vus: 5,
      duration: "60s",
    },
  },
  thresholds: {
    // At least 25% of requests must succeed (pool: 2 workers, 5 VUs → ~40% max)
    http_req_failed: ["rate<0.75"],
    // p95 success latency must stay under 30 s
    "http_req_duration{expected_response:true}": ["p(95)<30000"],
  },
};

export default function () {
  const res = http.put(`${TARGET_URL}/upload`, body.buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(BODY_SIZE),
    },
    // Large body — allow up to 60 s per request
    timeout: "60s",
  });

  check(res, {
    "status 200 or 503": (r) => r.status === 200 || r.status === 503,
    "no unexpected 5xx": (r) => r.status !== 500 && r.status !== 502,
  });

  // Brief pause between iterations — simulates realistic upload cadence
  // and prevents the test from being purely a spin loop on 503s.
  if (res.status === 503) {
    sleep(0.5); // Back off slightly when pool is full
  }
}
