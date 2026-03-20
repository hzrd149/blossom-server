/**
 * Admin proxy router — main thread side.
 *
 * Forwards all /admin/* requests to the admin worker,
 * awaits the rendered response, and returns it to the client.
 *
 * Uses the same pending-Map correlation pattern as the landing router.
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

export function buildAdminRouter(worker: Worker): Hono {
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
    console.error("Admin worker error:", event.message);
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(new Error("Admin worker error"));
    }
  };

  function proxyToWorker(c: Context): Promise<Response> {
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
  // Proxy all /admin/* requests (SSR pages + API endpoints)
  app.all("/admin", proxyToWorker);
  app.all("/admin/*", proxyToWorker);
  return app;
}
