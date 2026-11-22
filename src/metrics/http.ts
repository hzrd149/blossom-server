import type { MiddlewareHandler } from "@hono/hono";
import { extractBlobHash } from "../routes/blobs.ts";
import { mimeGroup, OperationMetrics } from "./operations.ts";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]);
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

/** Fixed categories: never expose request paths or identifiers as labels. */
export function routeCategory(path: string): string {
  if (path === "/") return "landing";
  if (/^\/(upload|mirror|media|report)\/?$/.test(path)) return path.split("/")[1];
  if (/^\/list\/[^/]+\/?$/.test(path)) return "list";
  if (path === "/admin" || path.startsWith("/admin/")) return "admin";
  if (path.startsWith("/api/")) return "api";
  if (["/client.js", "/styles.css", "/favicon.ico"].includes(path)) return "static";
  if (extractBlobHash(path.replace(/^\//, "").replace(/\/$/, ""))) return "blob";
  return "other";
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

interface Observation {
  count: number;
  sum: number;
  buckets: number[];
}

/** Application-local, bounded Prometheus text registry. No I/O during a scrape. */
export class HttpMetrics {
  readonly operations = new OperationMetrics();
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Observation>();
  private active = 0;
  private readonly started = Date.now() / 1000;

  constructor(private readonly version: string) {}

  readonly middleware: MiddlewareHandler = async (ctx, next) => {
    const method = METHODS.has(ctx.req.method) ? ctx.req.method : "OTHER";
    const route = routeCategory(new URL(ctx.req.url).pathname);
    const labels = `route="${route}",method="${method}"`;
    const start = performance.now();
    this.active++;
    let status = 500;
    try {
      await next();
      status = ctx.res.status;
      if (route === "blob" && method === "GET" && (status === 200 || status === 206) && ctx.res.body) {
        const labels = `response="${status === 206 ? "partial" : "full"}",mime_group="${mimeGroup(ctx.res.headers.get("content-type"))}"`;
        ctx.res = new Response(this.operations.stream(ctx.res.body, "download", labels), ctx.res);
      }
    } finally {
      this.active--;
      const key = `${labels},status="${status}"`;
      this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
      const seconds = (performance.now() - start) / 1000;
      const observation = this.durations.get(labels) ?? { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
      observation.count++;
      observation.sum += seconds;
      BUCKETS.forEach((bound, i) => {
        if (seconds <= bound) observation.buckets[i]++;
      });
      this.durations.set(labels, observation);
    }
  };

  render(): string {
    const lines: string[] = [];
    const family = (name: string, type: string, help: string) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    };
    family("blossom_build_info", "gauge", "Application build identity.");
    lines.push(`blossom_build_info{version="${escapeLabel(this.version)}"} 1`);
    family("blossom_process_start_time_seconds", "gauge", "Process instrumentation start time in Unix seconds.");
    lines.push(`blossom_process_start_time_seconds ${this.started}`);
    family("blossom_http_handlers_active", "gauge", "Handlers currently running; excludes response body streaming.");
    lines.push(`blossom_http_handlers_active ${this.active}`);
    family("blossom_http_requests_total", "counter", "Requests whose handlers have finished, by response status.");
    for (const [labels, count] of this.requests) lines.push(`blossom_http_requests_total{${labels}} ${count}`);
    const name = "blossom_http_handler_duration_seconds";
    family(name, "histogram", "Handler duration in seconds; excludes response body streaming.");
    for (const [labels, observation] of this.durations) {
      BUCKETS.forEach((bound, i) => lines.push(`${name}_bucket{${labels},le="${bound}"} ${observation.buckets[i]}`));
      lines.push(`${name}_bucket{${labels},le="+Inf"} ${observation.count}`);
      lines.push(`${name}_sum{${labels}} ${observation.sum}`, `${name}_count{${labels}} ${observation.count}`);
    }
    return lines.join("\n") + "\n" + this.operations.render() + "\n";
  }

  readonly fetch = (request: Request): Response => {
    if (new URL(request.url).pathname !== "/metrics") return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    return new Response(request.method === "HEAD" ? null : this.render(), {
      headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" },
    });
  };
}
