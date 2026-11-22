# Prometheus metrics

Enable the separate listener in the server YAML configuration:

```yaml
metrics:
  enabled: true
  host: 127.0.0.1
  port: 3001
```

The listener serves `GET /metrics` and `HEAD /metrics`. It has no authentication; use local scraping or authenticated private transport. It is independent of
the public application and admin dashboard. Defaults leave metrics disabled.

Example Prometheus configuration for a collector on the Blossom host:

```yaml
scrape_configs:
  - job_name: blossom
    static_configs:
      - targets: ["127.0.0.1:3001"]
```

## Testing with Docker Compose

In your local `config.yml`, enable the listener on the container interface:

```yaml
metrics:
  enabled: true
  host: 0.0.0.0
  port: 3001
```

Compose publishes port 3001 only on host loopback. Rebuild to include the metrics code:

```sh
docker compose up -d --build blossom
curl --fail http://127.0.0.1:3001/metrics
# Generate a request, then scrape again to see the request counter.
curl -s -o /dev/null http://127.0.0.1:3000/
curl --fail http://127.0.0.1:3001/metrics
```

Use `blossom:3001` for a Prometheus container on the same Compose network; `127.0.0.1:3001` is for clients running directly on the host.

### Local Prometheus

The optional `monitoring` profile includes Prometheus with the repository's `prometheus.yml`:

```sh
docker compose --profile monitoring up -d --build
```

Open <http://localhost:9090/targets> and confirm the `blossom` target is **UP**. Open <http://localhost:9090/query> and query `up{job="blossom"}` (expected: 1),
then `blossom_http_requests_total`. Browse the application at <http://localhost:3000> to generate requests. Allow a few five-second scrapes before using the
rate queries below.

The UI is published only on host loopback. Samples persist in the `prometheus-data` volume with seven-day/512-MB retention limits, whichever is reached first;
total disk usage also includes the write-ahead log and active data. Stop the collector with `docker compose --profile monitoring stop prometheus`. Avoid
`down -v`: that also deletes Blossom's application data volume.

## Metric contract

| Metric                                                | Type      | Meaning                                           |
| ----------------------------------------------------- | --------- | ------------------------------------------------- |
| `blossom_build_info{version}`                         | Gauge     | Build version, value 1                            |
| `blossom_process_start_time_seconds`                  | Gauge     | Instrumentation initialization time, Unix seconds |
| `blossom_http_handlers_active`                        | Gauge     | Currently executing handlers                      |
| `blossom_http_requests_total{route,method,status}`    | Counter   | Finished handlers, by response status             |
| `blossom_http_handler_duration_seconds{route,method}` | Histogram | Time until handler returns, in seconds            |

Route labels are fixed categories: landing, upload, mirror, media, report, list, admin, api, static, blob, other. They describe path families, not proof that a
request reached a particular handler. Methods outside the known HTTP vocabulary use `OTHER`. Labels never contain hashes, pubkeys, raw paths, or query strings.

Histogram buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60 seconds, and infinity. Series appear when first observed. Counters reset on
restart; each application has its own registry. Scrapes do not count as traffic.

Handler completion is **not download completion**. Use the stream metrics below for body lifetime and proxy metrics for client delivery accounting.

### Download and storage streams

| Metric                                       | Meaning                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `blossom_download_active`                    | Open GET 200/206 body streams                                    |
| `blossom_download_bytes_total`               | Bytes pulled from response bodies                                |
| `blossom_download_streams_total`             | Terminal outcomes: completed, cancelled, error                   |
| `blossom_download_duration_seconds`          | Stream lifetime histogram, including consumer wait time          |
| `blossom_storage_read_active`                | Open storage read streams                                        |
| `blossom_storage_read_bytes_total`           | Bytes pulled from storage streams                                |
| `blossom_storage_read_streams_total`         | Storage stream terminal outcomes                                 |
| `blossom_storage_read_duration_seconds`      | Storage stream lifetime histogram                                |
| `blossom_storage_operations_total`           | Storage API calls by backend, operation, outcome                 |
| `blossom_storage_operation_duration_seconds` | API call duration, excluding subsequent body reads               |
| `blossom_s3_caught_errors_total`             | Errors caught inside S3 adapter, including internal dedup checks |

Download labels are `response` (full/partial) and `mime_group` (image/video/audio/text/other). Storage labels are `backend` (local/s3) and `operation` (the
fixed storage interface method name). Terminal counters and stream histograms also carry `outcome`. Duration buckets are 0.01, 0.1, 1, 10, 60, 300, 1800 seconds
and infinity. Series appear when first observed, rather than implying that unused features are active.

Completed means the observer read EOF; cancelled means its consumer cancelled, including disconnects and intentional Range fallback truncation. A completed
partial download can therefore accompany a cancelled full storage read. HEAD, 304, errors, and redirects create no download stream. Application bytes are not
confirmed client delivery or provider billing, and must not be added to storage bytes. The wrappers are demand-driven and do not buffer complete blobs.

Storage API outcomes are `returned`, `empty` (null/false), and `error` (thrown). Empty is deliberately not called "missing": the S3 adapter retains its existing
suppressed-error behavior, and MIME metadata can be unknown. S3 caught errors have fixed reasons `not_found` (explicit NoSuchKey/NotFound code) or
`backend_error` (all other failures, including ambiguous responses). Consult both counters for S3 health; caught-error and API counters describe different
boundaries and should not be summed. Storage writes currently have API timings/outcomes, not streamed write-byte accounting.

Example queries:

```promql
sum(blossom_download_active)
sum by (mime_group) (rate(blossom_download_bytes_total[5m]))
sum by (outcome) (rate(blossom_download_streams_total[5m]))
sum by (operation) (rate(blossom_s3_caught_errors_total{reason="backend_error"}[5m]))
```

## Useful queries

### Workers, pruning, and inventory

When metrics are enabled, inventory refreshes at startup and then every `metrics.inventoryIntervalMs` (default 60000, minimum 1000) after the previous
collection completes. Each refresh uses one read transaction. Aggregate query cost scales with database size; increase the interval for large installations.
Scrapes never query the database. Failed refreshes retain the last good snapshot. Before the first successful refresh, inventory totals are absent and
last-success is zero.

| Metric                                                                                                 | Meaning                                                                                |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `blossom_worker_jobs_active`                                                                           | Outstanding upload worker jobs                                                         |
| `blossom_worker_jobs_capacity`                                                                         | Job slots on live workers                                                              |
| `blossom_worker_jobs_configured_capacity`                                                              | Initial configured job capacity                                                        |
| `blossom_worker_capacity_rejections_total`                                                             | Dispatches rejected when no live slot is available                                     |
| `blossom_worker_jobs_total{outcome}`                                                                   | success, error, crash, dispatch_error, shutdown                                        |
| `blossom_worker_job_duration_seconds{outcome}`                                                         | Time from dispatch to settlement                                                       |
| `blossom_worker_crashes_total`                                                                         | Uncaught worker errors; affected workers are removed, not restarted                    |
| `blossom_prune_enabled`, `blossom_prune_running`                                                       | Scheduled pruning configuration and current activity                                   |
| `blossom_prune_last_attempt_timestamp_seconds`                                                         | Latest scheduled attempt, zero before first attempt                                    |
| `blossom_prune_last_success_timestamp_seconds`                                                         | Latest error-free cycle, zero before first success                                     |
| `blossom_prune_cycles_total{outcome}`                                                                  | Scheduled success/error cycles                                                         |
| `blossom_prune_errors_total`                                                                           | Query, rule-validation, deletion, and unexpected cycle errors                          |
| `blossom_prune_duration_seconds{outcome}`                                                              | Scheduled cycle duration                                                               |
| `blossom_prune_deleted_blobs_total`, `blossom_prune_deleted_bytes_total`                               | Completed deletions and logical bytes, including thumbnails and already absent objects |
| `blossom_inventory_blobs{mime_group}`, `blossom_inventory_bytes{mime_group}`                           | Cached metadata count and logical bytes, including derivatives                         |
| `blossom_inventory_owner_associations`                                                                 | Associations, not distinct owners                                                      |
| `blossom_inventory_reports`                                                                            | All stored reports; not a pending-only queue or verified findings                      |
| `blossom_inventory_last_attempt_timestamp_seconds`, `blossom_inventory_last_success_timestamp_seconds` | Collection freshness                                                                   |
| `blossom_inventory_collecting`                                                                         | Refresh in progress                                                                    |
| `blossom_inventory_collection_errors_total`, `blossom_inventory_collection_duration_seconds`           | Collection health                                                                      |

Worker success means hashing and temporary-file writing completed, not a successful final blob commit. A successful prune cycle means its bounded batch finished
without errors, not that all expired blobs have been scanned. S3 deletion errors now propagate rather than being treated as successful cleanup; explicit
missing-object responses remain harmless. Inventory bytes are metadata totals, not physical storage or billing totals. MIME labels remain
image/video/audio/text/other.

Run **one expression at a time** in the Prometheus query UI.

Worker utilization:

```promql
blossom_worker_jobs_active / blossom_worker_jobs_capacity
```

Logical storage growth:

```promql
sum(blossom_inventory_bytes)
```

Inventory age (also check last-success equals zero for a collector that has never succeeded):

```promql
time() - blossom_inventory_last_success_timestamp_seconds
```

Prune errors:

```promql
increase(blossom_prune_errors_total[1h])
```

### HTTP

Request rate:

```promql
sum by (route) (rate(blossom_http_requests_total[5m]))
```

95th percentile handler latency:

```promql
histogram_quantile(0.95, sum by (le, route) (rate(blossom_http_handler_duration_seconds_bucket[5m])))
```

Missing telemetry (keep separate from zero request traffic):

```promql
up{job="blossom"} == 0
```

Also alert on missing targets using your deployment's expected target inventory; `up == 0` alone does not detect a target removed from scrape configuration.
