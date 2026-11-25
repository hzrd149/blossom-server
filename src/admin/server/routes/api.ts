import { type Context, Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { z } from "zod";
import { InvalidConfigError } from "../../../config/loader.ts";
import { ConfigChangedError, ConfigNotWritableError } from "../../../config/editor.ts";
import { ContentQuerySchema } from "../../contracts/content.ts";
import { ReportCleanupSchema, ReportsQuerySchema } from "../../contracts/reports.ts";
import type { AdminApiError } from "../../contracts/errors.ts";
import { RenderRulesBodySchema, RulePreviewBodySchema, SaveRulesBodySchema } from "../../contracts/rules.ts";
import type { ManagementServices } from "../../services/index.ts";
import { UserKeySchema, UserPageQuerySchema, UserReportsQuerySchema, UsersQuerySchema } from "../../contracts/users.ts";
import {
  BanBlobBodySchema,
  BannedBlobsQuerySchema,
  BanPubkeyBodySchema,
  ModerationPageQuerySchema,
  parseBlobRef,
  ReportBanBodySchema,
} from "../../contracts/moderation.ts";
import { HEX64_RE, normalizePubkey } from "../../../policy/moderation-schema.ts";
import { ModerationInputError } from "../../../moderation/service.ts";

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

/** Like parseBody, but an empty body parses as {}. */
async function parseOptionalBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const text = await c.req.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new InvalidRequest("Request body must be JSON");
    }
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new InvalidRequest("Invalid request body", zodIssues(parsed.error));
  return parsed.data;
}

export function buildAdminApi(services: ManagementServices): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof InvalidRequest) return c.json<AdminApiError>({ error: err.message, issues: err.issues }, 400);
    if (err instanceof ModerationInputError) return c.json<AdminApiError>({ error: err.message }, 400);
    if (err instanceof z.ZodError) return c.json<AdminApiError>({ error: "Invalid request", issues: zodIssues(err) }, 400);
    if (err instanceof InvalidConfigError) return c.json<AdminApiError>({ error: "Invalid configuration", issues: err.issues }, 400);
    if (err instanceof ConfigChangedError || err instanceof ConfigNotWritableError) {
      return c.json<AdminApiError>({ error: err.message }, 409);
    }
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
  app.get("/configuration", async (c) => c.json(await services.configuration.summary()));

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
  app.post("/reports/cleanup", async (c) => {
    const { target } = await parseBody(c, ReportCleanupSchema);
    return c.json({ success: true, deleted: await services.reports.cleanup(target) });
  });
  app.post("/reports/:id/:action", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "Invalid report id" }, 400);
    const action = c.req.param("action");
    if (action === "ban-blob") {
      const result = await services.moderation.banReportedBlob(id, await parseOptionalBody(c, ReportBanBodySchema));
      return result ? c.json({ success: true, ...result }) : c.json({ error: "Report not found" }, 404);
    }
    if (action !== "dismiss" && action !== "delete-blob") return c.json({ error: "Not found" }, 404);
    const found = action === "dismiss" ? await services.reports.dismiss(id) : await services.reports.deleteContent(id);
    if (!found) return c.json({ error: "Report not found" }, 404);
    return c.json({ success: true });
  });

  // Storage rules and prune.
  // Rules live in config.yml: PUT writes the file (when writable) and applies it,
  // render returns the updated file for copying, reload applies a hand-edited file.
  app.get("/rules", async (c) => c.json(await services.rules.view()));
  app.put("/rules", async (c) => {
    const body = await parseBody(c, SaveRulesBodySchema);
    return c.json(await services.rules.save(body.rules, body.hash));
  });
  app.post("/rules/render", async (c) => c.json(await services.rules.render((await parseBody(c, RenderRulesBodySchema)).rules)));
  app.post("/rules/reload", async (c) => c.json(await services.rules.reload()));
  app.post("/rules/preview", async (c) => c.json(await services.rules.preview(await parseBody(c, RulePreviewBodySchema))));
  app.get("/prune/status", (c) => c.json(services.prune.status()));
  app.post("/prune/run", (c) => {
    if (!services.prune.trigger()) return c.json<AdminApiError>({ error: "A prune cycle is already running" }, 409);
    return c.json({ started: true }, 202);
  });

  // Moderation (docs/moderation/local-bans.md): local pubkey and blob bans.
  const hashParam = (c: Context): string => {
    const hash = c.req.param("sha256")?.toLowerCase() ?? "";
    if (!HEX64_RE.test(hash)) throw new InvalidRequest("Expected a 64-character hex SHA-256");
    return hash;
  };
  const pubkeyParam = (c: Context): string => {
    const pubkey = normalizePubkey(c.req.param("pubkey") ?? "");
    if (!pubkey) throw new InvalidRequest("Expected a 64-character hex pubkey or an npub");
    return pubkey;
  };
  app.get("/bans/pubkeys", async (c) => c.json(await services.moderation.listBannedPubkeys(ModerationPageQuerySchema.parse(c.req.query()))));
  app.post("/bans/pubkeys", async (c) => c.json(await services.moderation.banPubkey(await parseBody(c, BanPubkeyBodySchema))));
  app.get("/bans/pubkeys/:pubkey", async (c) => c.json(await services.moderation.pubkeyStatus(pubkeyParam(c))));
  app.delete("/bans/pubkeys/:pubkey", async (c) => {
    if (!(await services.moderation.unbanPubkey(pubkeyParam(c)))) return c.json<AdminApiError>({ error: "Pubkey is not banned" }, 404);
    return c.json({ success: true });
  });
  app.get("/bans/blobs", async (c) => c.json(await services.moderation.listBannedBlobs(BannedBlobsQuerySchema.parse(c.req.query()))));
  app.post("/bans/blobs", async (c) => c.json(await services.moderation.banBlob(await parseBody(c, BanBlobBodySchema))));
  app.delete("/bans/blobs/:sha256", async (c) => {
    if (!(await services.moderation.unbanBlob(hashParam(c)))) return c.json<AdminApiError>({ error: "Blob is not banned" }, 404);
    return c.json({ success: true });
  });

  app.get("/moderation/blobs/:ref", async (c) => {
    const hash = parseBlobRef(c.req.param("ref"));
    if (!hash) throw new InvalidRequest("Expected a 64-character hex SHA-256");
    return c.json(await services.moderation.blobStatus(hash));
  });

  app.all("*", (c) => c.json({ error: "Not found" }, 404));
  return app;
}
