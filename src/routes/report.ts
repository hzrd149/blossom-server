import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { NostrEvent } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";
import type { BlossomVariables } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import { insertReport, REPORT_TYPES } from "../db/reports.ts";
import type { ReportType } from "../db/reports.ts";

const SHA256_RE = /^[0-9a-f]{64}$/;

function isStringTagArray(value: unknown): value is string[][] {
  return Array.isArray(value) &&
    value.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === "string"));
}

function isReportEvent(value: Record<string, unknown>): value is NostrEvent {
  return value.kind === 1984 &&
    typeof value.id === "string" &&
    typeof value.pubkey === "string" &&
    typeof value.created_at === "number" &&
    typeof value.content === "string" &&
    typeof value.sig === "string" &&
    isStringTagArray(value.tags);
}

export function buildReportRouter(
  db: Client,
): Hono<{ Variables: BlossomVariables }> {
  const app = new Hono<{ Variables: BlossomVariables }>();

  app.put("/report", async (ctx) => {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return errorResponse(ctx, 400, "Request body must be valid JSON");
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(ctx, 400, "Request body must be a JSON object");
    }

    const event = body as Record<string, unknown>;

    if (event.kind !== 1984) {
      return errorResponse(ctx, 400, "Report event must be kind 1984");
    }

    if (!isReportEvent(event)) {
      return errorResponse(ctx, 400, "Report event is missing required fields");
    }

    let verified = false;
    try {
      verified = verifyEvent(event);
    } catch {
      verified = false;
    }
    if (!verified) {
      return errorResponse(ctx, 400, "Report event signature is invalid");
    }

    const xTags = event.tags.filter((t) => Array.isArray(t) && t[0] === "x" && typeof t[1] === "string") as [
      string,
      string,
      string?,
    ][];

    if (xTags.length === 0) {
      return errorResponse(
        ctx,
        400,
        "Report event must contain at least one x tag",
      );
    }

    const eventId = event.id;
    const reporter = event.pubkey;
    const content = event.content;
    const created = event.created_at;

    const invalidHashes = xTags.filter((t) => !SHA256_RE.test(t[1]));
    if (invalidHashes.length > 0) {
      return errorResponse(
        ctx,
        400,
        `Invalid blob hash in x tag: ${invalidHashes[0][1]}`,
      );
    }

    for (const [, blobHash, reportType] of xTags) {
      const type = reportType && (REPORT_TYPES as readonly string[]).includes(reportType) ? (reportType as ReportType) : null;

      await insertReport(db, {
        event_id: eventId,
        reporter,
        blob: blobHash,
        type,
        content,
        created,
      });
    }

    return ctx.json({ success: true }, 200);
  });

  return app;
}
