import { Hono } from "@hono/hono";
import { ContentQuerySchema } from "../../contracts/content.ts";
import type { ManagementServices } from "../../services/index.ts";

export function buildAdminApi(services: ManagementServices): Hono {
  const app = new Hono();
  app.get("/content", async (c) => {
    const parsed = ContentQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Invalid content query" }, 400);
    return c.json(await services.content.list(parsed.data));
  });
  app.get("/summary", async (c) => c.json(await services.content.summary()));
  app.get("/configuration", (c) => c.json(services.configuration.summary()));

  app.delete("/blobs/:sha256", async (c) => {
    const hash = c.req.param("sha256");
    if (!/^[a-f0-9]{64}$/.test(hash)) return c.json({ error: "Invalid blob hash" }, 400);
    await services.content.forceDelete(hash);
    return c.json({ success: true });
  });
  app.delete("/users/:pubkey", async (c) => {
    const pubkey = c.req.param("pubkey");
    if (!/^[a-f0-9]{64}$/.test(pubkey)) return c.json({ error: "Invalid pubkey" }, 400);
    return c.json({ success: true, deleted: await services.users.deleteContent(pubkey) });
  });
  app.post("/reports/:id/:action", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "Invalid report id" }, 400);
    const action = c.req.param("action");
    if (action !== "dismiss" && action !== "delete-blob") return c.json({ error: "Not found" }, 404);
    const found = action === "dismiss" ? await services.reports.dismiss(id) : await services.reports.deleteContent(id);
    if (!found) return c.json({ error: "Report not found" }, 404);
    return c.json({ success: true });
  });
  app.all("*", (c) => c.json({ error: "Not found" }, 404));
  return app;
}
