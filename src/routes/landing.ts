/**
 * Landing page proxy router — main thread side.
 *
 * Forwards GET / and GET /assets/client.js to the landing worker,
 * awaits the rendered response, and returns it to the client.
 *
 * Uses the same pending-Map correlation pattern as UploadWorkerPool.
 */

import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";

interface PendingRequest {
  resolve: (data: WorkerResponse) => void;
  reject: (err: Error) => void;
}

interface WorkerResponse {
  id: string;
  status: number;
  headers: [string, string][];
  body: string;
}

export function buildLandingRouter(worker: Worker): Hono {
  const pending = new Map<string, PendingRequest>();
  let counter = 0;

  // Single onmessage handler routes all responses back to their Promises
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type !== "response") return;
    const p = pending.get(data.id);
    if (!p) return; // stale — ignore
    pending.delete(data.id);
    p.resolve(data as WorkerResponse);
  };

  worker.onerror = (event) => {
    console.error("Landing worker error:", event.message);
    // Reject all in-flight requests
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(new Error("Landing worker error"));
    }
  };

  async function proxyToWorker(c: Context): Promise<Response> {
    const id = String(++counter);
    const msg = {
      type: "request",
      id,
      method: c.req.method,
      url: c.req.url,
      headers: [...c.req.raw.headers] as [string, string][],
    };

    return new Promise<Response>((resolve, reject) => {
      pending.set(id, {
        resolve: (data) => {
          resolve(
            new Response(data.body, {
              status: data.status,
              headers: data.headers,
            }),
          );
        },
        reject,
      });
      worker.postMessage(msg);
    });
  }

  const app = new Hono();
  app.get("/", proxyToWorker);
  app.get("/assets/client.js", proxyToWorker);
  return app;
}
