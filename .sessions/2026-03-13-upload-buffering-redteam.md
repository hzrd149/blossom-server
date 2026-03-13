---
date: 2026-03-13
cwd: /home/user/Projects/blossom-server
tags: [deno, blossom, security, red-team, upload]
provider: opencode
session_id: ses_31897c7c5ffe2LJsrn10S4dqE2
---

# Upload Buffering Defense Red-Team Analysis

## Summary

A 32-agent red-team (ParallelAnalysis workflow) stress-tested a proposed
five-layer upload buffering defense for a Deno blob server targeting RAM
exhaustion prevention. The analysis found that the defense holds only against
naive single-IP, Content-Length-honest, direct-connection attackers — a threat
model that describes no real adversary. Twelve distinct attack vectors were
identified, with four rated CRITICAL and five rated HIGH, leaving the design
substantially incomplete against real-world attack patterns.

## Decisions

- **Layer 1 (Content-Length pre-check) is defeated by HTTP spec**: chunked
  transfer encoding requires no `Content-Length`; an attacker sending
  `Content-Length: 1` followed by 500MB of data may bypass the check entirely
  depending on how Deno's HTTP layer enforces declared lengths.
- **Layer 2 (per-IP connection limit) is defeated by cost**: residential proxy
  botnets provide hundreds of source IPs for ~$5/hour; 100 IPs × 2 connections
  each fills pool + queue while staying under per-IP limits.
- **Layer 3 (pool-full 503) has a body-accumulation window**:
  `req.body.cancel()` in Deno's hyper-based HTTP/2 implementation queues
  RST_STREAM asynchronously — body bytes accumulate in hyper's app-level receive
  window between the 503 response and actual connection teardown.
- **Layer 4 (OS buffer model) is invalidated by reverse proxies**: nginx, Caddy,
  and cloud ALBs buffer the entire request body before forwarding to Deno; all
  OS backpressure reasoning is irrelevant in the majority of real deployments.
- **Worst-case memory is never quantified and may be unsafe**: 16-core server
  with pool=16, queue=32 means up to 48 × 100MB = 4.8GB in-flight during
  legitimate peak load alone, before any attack.
- **fd exhaustion is the binding constraint, not RAM**: no fd ceiling is set;
  1000s of short rejected connections exhaust the default fd limit (1024 on many
  Linux systems) before RAM becomes the issue.
- **Slow-drip chunked uploads defeat multiple layers simultaneously**: body sent
  at 1KB/sec bypasses Content-Length check, avoids OS backpressure engagement,
  holds a queue slot for 30 seconds, and evades byte-rate limiting.
- **The strongest single layer is Layer 3 (pool-full 503)**: it uses no
  client-controlled inputs; the check is against a server-side counter only.
- **OS TCP backpressure is the most reliable foundation**: kernel-enforced
  physics cannot be bypassed from userspace and is the correct fail-safe of last
  resort.

## Files Modified

- None. Read-only security analysis session; no files were created or changed.

## Problems Solved

- **Red-team question 1 (what does Content-Length check NOT prevent)**: chunked
  encoding uploads, lied-about Content-Length followed by oversized body, any
  HTTP/2 upload without a declared length.
- **Red-team question 2 (chunked encoding with no Content-Length)**: Layer 1 is
  skipped or ineffective; the fallback "streaming size check" requires partial
  buffering before triggering, and is underspecified in the design.
- **Red-team question 3 (worst-case memory with pool-full 503)**: (pool + queue)
  × OS recv buffer = 48 × 4MB = 192MB from OS alone; plus hyper RST_STREAM delay
  window adds app-level accumulation per connection.
- **Red-team question 4 (bypass per-IP limit via distributed IPs)**: trivially
  bypassed; 100 IPs × 2 connections costs ~$5/hour via residential proxies.
- **Red-team question 5 (is Layer 4 OS buffering actually safe)**: not
  quantified and potentially unsafe at scale; 48-connection steady-state with
  slow-drip maintains constant memory pressure; 30-second timeout rotates
  connections without draining the queue.
- **Red-team question 6 (minimum viable defense set)**: enforce streaming byte
  cap for chunked uploads; set global fd ceiling; add connection-rate limit
  (conns/sec/IP); calculate and validate the actual memory ceiling; document
  proxy deployment assumptions; audit the blob-serving read path.
- **Red-team question 7 (attacks on layer ordering)**: no ordering bypass found
  — middleware-before-handler is structurally sound — but the layers
  individually fail; it is the per-layer assumptions, not the ordering, that are
  exploitable.

## Open Questions

- Is `req.body.cancel()` in Deno's current hyper version synchronous or async
  with respect to TCP teardown? (Needs Deno internals or empirical test.)
- What is the actual OS recv buffer configuration on the target deployment
  environment? (If `net.core.rmem_max` is tuned, the 1-4MB bound is wrong.)
- Does the Deno HTTP layer enforce declared `Content-Length` against actual
  bytes received, or does it pass overlong bodies through?
- Should blob serving (read path) have its own concurrency cap and streaming
  chunk size limit? (Identified as a larger OOM risk than uploads.)
- Is a reverse proxy (nginx, Caddy, ALB) assumed in the deployment topology? If
  so, `client_max_body_size` does the work and all five Deno-side layers are
  partially redundant.

## Next Steps

- Reject no-`Content-Length` requests OR enforce a streaming byte counter that
  fires before body accumulates (fixes chunked encoding gap).
- Enforce declared `Content-Length` at the Deno HTTP layer — verify actual bytes
  received match; abort at threshold.
- Add connection-rate limit (connections/sec/IP) separate from
  concurrent-connection limit to cap fd consumption.
- Add global fd ceiling via `ulimit -n` and refuse new connections when
  (active_fds > max_fd - headroom).
- Calculate and document the actual memory ceiling: (pool + queue) ×
  maxUploadSize — validate it fits in available RAM before deploying.
- Document proxy deployment assumptions explicitly; if behind nginx/ALB,
  `client_max_body_size` is the primary defense and Deno layers are secondary.
- Audit the blob-serving read path: add concurrent-read limit and streaming
  chunk size cap.
- Empirically test `req.body.cancel()` teardown latency under HTTP/2 to measure
  the RST_STREAM delay window.

## Learnings

### (fact) Deno req.body.cancel() does not guarantee synchronous TCP close — hyper-rs queues RST_STREAM asynchronously

In Deno's hyper-based HTTP/2 implementation, calling `req.body.cancel()` after
sending a rejection response (e.g., 503) does not immediately close the TCP
connection. The RST_STREAM frame is queued asynchronously, leaving a window
during which the client continues sending body bytes that accumulate in hyper's
app-level receive buffer — distinct from the OS TCP receive buffer. Any
rejection middleware that relies on `cancel()` for immediate memory reclamation
has a silent accumulation window between response send and actual teardown.
