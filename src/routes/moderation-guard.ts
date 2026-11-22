/**
 * Moderation enforcement helpers shared by the Blossom routes (docs/moderation/local-bans.md#enforcement).
 *
 * Pubkey checks are in-memory. Hash checks are a single indexed lookup of the local ban table.
 * Banned blobs are deleted when the ban is created, so read routes need no check.
 */

import type { Context } from "@hono/hono";
import { type BlossomVariables, optionalAuth } from "../middleware/auth.ts";
import { errorResponse } from "../middleware/errors.ts";
import type { ModerationService } from "../moderation/service.ts";

/** X-Reason for content blocked by a local blob ban. */
export const BLOB_BLOCKED_REASON = "blob is blocked";
/** X-Reason for requests authenticated by a banned pubkey. */
export const PUBKEY_BANNED_REASON = "pubkey is banned";

type Ctx = Context<{ Variables: BlossomVariables }>;

/** True when the request carries valid BUD-11 auth from a banned pubkey. Anonymous requests are never banned. */
export function isAuthPubkeyBanned(ctx: Ctx, moderation: Pick<ModerationService, "isPubkeyBanned">): boolean {
  const pubkey = optionalAuth(ctx)?.pubkey;
  return pubkey !== undefined && moderation.isPubkeyBanned(pubkey);
}

/** Cancel any request body, then respond 403 `pubkey is banned`. */
export async function rejectBannedPubkey(ctx: Ctx): Promise<Response> {
  await ctx.req.raw.body?.cancel().catch(() => {});
  return errorResponse(ctx, 403, PUBKEY_BANNED_REASON);
}

/** Cancel any request body, then respond 403 `blob is blocked`. */
export async function rejectBlockedBlob(ctx: Ctx): Promise<Response> {
  await ctx.req.raw.body?.cancel().catch(() => {});
  return errorResponse(ctx, 403, BLOB_BLOCKED_REASON);
}
