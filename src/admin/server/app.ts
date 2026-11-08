import { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import type { Config } from "../../config/schema.ts";
import type { ManagementServices } from "../services/index.ts";
import { adminAuth, adminMutationGuard } from "./middleware/auth.ts";
import { buildAdminApi } from "./routes/api.ts";

export interface AdminDependencies {
  config: Config;
  services: ManagementServices;
}

export function buildAdminApp({ config, services }: AdminDependencies): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error("[admin] Request failed:", err);
    return c.json({ error: "Internal server error" }, 500);
  });
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  app.use("*", adminAuth(config), adminMutationGuard);
  app.route("/api", buildAdminApi(services));
  app.get("/assets/:file", async (c) => {
    const file = c.req.param("file");
    if (file !== "client.js" && file !== "styles.css") return c.notFound();
    try {
      const bytes = await Deno.readFile(new URL(`../../../public/admin/${file}`, import.meta.url));
      return c.body(bytes, 200, { "Content-Type": file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8" });
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      return c.text("Admin assets unavailable. Run deno task build:admin.", 503);
    }
  });
  app.get("/console", (c) => c.redirect("/admin", 302));
  app.get("/", (c) =>
    c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blossom management</title><link rel="stylesheet" href="/admin/assets/styles.css"></head>
<body><div id="admin-root"><p>Loading management console…</p></div><noscript>This console requires JavaScript.</noscript>
<script type="module" src="/admin/assets/client.js"></script></body></html>`));
  app.all("*", (c) => c.text("Admin page not found", 404));
  return app;
}
