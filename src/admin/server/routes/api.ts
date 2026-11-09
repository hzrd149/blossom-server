import { type Context, Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { z } from "zod";
import { RulesVersionConflict } from "../../../db/storage-rules.ts";
import { RulesNotEditableError } from "../../../policy/rule-store.ts";
import { ContentQuerySchema } from "../../contracts/content.ts";
import { ReportsQuerySchema } from "../../contracts/reports.ts";
import type { AdminApiError } from "../../contracts/errors.ts";
import { ReplaceRulesBodySchema, ResetRulesBodySchema, RulePreviewBodySchema } from "../../contracts/rules.ts";
import type { ManagementServices } from "../../services/index.ts";
import { UserKeySchema, UserPageQuerySchema, UserReportsQuerySchema, UsersQuerySchema } from "../../contracts/users.ts";

class InvalidRequest extends Error {
  constructor(message: string, readonly issues: AdminApiError["issues"] = undefined) {
    super(message);
  }
}

function zodIssues(error: z.ZodError): NonNullable<AdminApiError["issues"]> {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/** Parse a JSON body against a schema, throwing InvalidRequest (→ 400) on failure. */
async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const body: unknown = await c.req.json().catch(() => {
    throw new InvalidRequest("Request body must be JSON");
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new InvalidRequest("Invalid request body", zodIssues(parsed.error));
  return parsed.data;
}

export function buildAdminApi(services: ManagementServices): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof InvalidRequest) return c.json<AdminApiError>({ error: err.message, issues: err.issues }, 400);
    if (err instanceof z.ZodError) return c.json<AdminApiError>({ error: "Invalid request", issues: zodIssues(err) }, 400);
    if (err instanceof RulesVersionConflict) {
      return c.json<AdminApiError>({ error: "Rules were changed by someone else; reload and retry", version: err.current }, 409);
    }
    if (err instanceof RulesNotEditableError) return c.json<AdminApiError>({ error: err.message }, 409);
    if (err instanceof HTTPException) return err.getResponse();
    console.error("[admin] API request failed:", err);
    return c.json<AdminApiError>({ error: "Internal server error" }, 500);
  });
  app.get("/content", async (c) => {
    const parsed = ContentQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Invalid content query" }, 400);
    return c.json(await services.content.list(parsed.data));
  });
  app.get("/summary", async (c) => c.json(await services.content.summary()));
  app.get("/reports", async (c) => c.json(await services.reports.list(ReportsQuerySchema.parse(c.req.query()))));
  app.get("/configuration", (c) => c.json(services.configuration.summary()));

  app.get("/blobs/:sha256", async (c) => {
    const hash = c.req.param("sha256").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return c.json<AdminApiError>({ error: "Invalid blob hash" }, 400);
    const detail = await services.content.detail(hash);
    if (!detail) return c.json<AdminApiError>({ error: "Blob not found" }, 404);
    return c.json(detail);
  });
  app.delete("/blobs/:sha256", async (c) => {
    const hash = c.req.param("sha256");
    if (!/^[a-f0-9]{64}$/.test(hash)) return c.json({ error: "Invalid blob hash" }, 400);
    await services.content.forceDelete(hash);
    return c.json({ success: true });
  });
  app.get("/users", async (c) => c.json(await services.users.list(UsersQuerySchema.parse(c.req.query()))));
  app.get("/users/:pubkey", async (c) => {
    const user = await services.users.detail(UserKeySchema.parse(c.req.param("pubkey")));
    return user ? c.json(user) : c.json({ error: "User not found" }, 404);
  });
  app.get(
    "/users/:pubkey/blobs",
    async (c) => c.json(await services.users.blobs(UserKeySchema.parse(c.req.param("pubkey")), UserPageQuerySchema.parse(c.req.query()))),
  );
  app.get(
    "/users/:pubkey/reports",
    async (c) => c.json(await services.users.reports(UserKeySchema.parse(c.req.param("pubkey")), UserReportsQuerySchema.parse(c.req.query()))),
  );
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

  // Storage rules and prune.
  app.get("/rules", (c) => c.json(services.rules.view()));
  app.put("/rules", async (c) => {
    const body = await parseBody(c, ReplaceRulesBodySchema);
    return c.json(await services.rules.replace(body.rules, body.version));
  });
  app.post("/rules/reset-to-config", async (c) => {
    const body = await parseBody(c, ResetRulesBodySchema);
    return c.json(await services.rules.reset(body.version));
  });
  app.post("/rules/preview", async (c) => c.json(await services.rules.preview(await parseBody(c, RulePreviewBodySchema))));
  app.get("/prune/status", (c) => c.json(services.prune.status()));
  app.post("/prune/run", (c) => {
    if (!services.prune.trigger()) return c.json<AdminApiError>({ error: "A prune cycle is already running" }, 409);
    return c.json({ started: true }, 202);
  });

  app.all("*", (c) => c.json({ error: "Not found" }, 404));
  return app;
}
