/**
 * BUD-09: PUT /report — Submit a blob report
 *
 * The request body MUST be a signed NIP-56 kind:1984 Nostr event containing
 * one or more x tags with the SHA-256 hashes of the blobs being reported.
 *
 * One database row is written per (event_id, blob) pair, so a single report
 * event covering multiple blobs produces multiple rows.
 *
 * Authentication is optional by default (config.report.requireAuth).
 * When requireAuth is true, a valid BUD-11 Authorization header is required
 * (verb "upload" — the closest BUD-11 verb for a write operation).
 */

import { Hono } from "@hono/hono";
import type { Client } from "@libsql/client";
import type { NostrEvent } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";
import { requireAuth } from "../middleware/auth.ts";
import type { BlossomVariables } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { Config } from "../config/schema.ts";
import { insertReport, REPORT_TYPES } from "../db/reports.ts";
import type { ReportType } from "../db/reports.ts";

/** 64 lowercase hex chars — matches a valid SHA-256 digest. */
const SHA256_RE = /^[0-9a-f]{64}$/;

export function buildReportRouter(
  db: Client,
  config: Config,
): Hono<{ Variables: BlossomVariables }> {
  const app = new Hono<{ Variables: BlossomVariables }>();

  // ── PUT /report ─────────────────────────────────────────────────────────────
  app.put("/report", async (ctx) => {
    // ── 1. Auth gate ───────────────────────────────────────────────────────────
    if (config.report.requireAuth) {
      requireAuth(ctx, "upload");
    }

    // ── 2. Parse body as JSON ─────────────────────────────────────────────────
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

    // ── 3. Validate kind ──────────────────────────────────────────────────────
    if (event.kind !== 1984) {
      return errorResponse(ctx, 400, "Report event must be kind 1984");
    }

    // ── 4. Validate required NIP-01 fields are present ────────────────────────
    if (
      typeof event.id !== "string" ||
      typeof event.pubkey !== "string" ||
      typeof event.created_at !== "number" ||
      typeof event.sig !== "string" ||
      !Array.isArray(event.tags)
    ) {
      return errorResponse(ctx, 400, "Report event is missing required fields");
    }

    // ── 5. Verify signature ───────────────────────────────────────────────────
    let verified = false;
    try {
      verified = verifyEvent(event as unknown as NostrEvent);
    } catch {
      verified = false;
    }
    if (!verified) {
      return errorResponse(ctx, 400, "Report event signature is invalid");
    }

    // ── 6. Extract x tags ────────────────────────────────────────────────────
    const tags = event.tags as unknown[][];
    const xTags = tags.filter((t) =>
      Array.isArray(t) && t[0] === "x" && typeof t[1] === "string"
    ) as [
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

    // ── 7. Validate each hash and insert rows ─────────────────────────────────
    const eventId = event.id as string;
    const reporter = event.pubkey as string;
    const content = typeof event.content === "string" ? event.content : "";
    const created = event.created_at as number;

    const invalidHashes = xTags.filter((t) => !SHA256_RE.test(t[1]));
    if (invalidHashes.length > 0) {
      return errorResponse(
        ctx,
        400,
        `Invalid blob hash in x tag: ${invalidHashes[0][1]}`,
      );
    }

    // Insert one row per x tag. INSERT OR IGNORE makes this idempotent.
    for (const [, blobHash, reportType] of xTags) {
      const type =
        reportType && (REPORT_TYPES as readonly string[]).includes(reportType)
          ? (reportType as ReportType)
          : null;

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
