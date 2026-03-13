import { Request } from "koa";
import Router from "@koa/router";
import dayjs from "dayjs";
import HttpErrors from "http-errors";
import { verifyEvent, NostrEvent } from "nostr-tools";
import { BlobMetadata } from "blossom-server-sdk";

import logger from "../logger.js";
import { getBlobURL } from "../helpers/blob.js";
import { config } from "../config.js";

export const log = logger.extend("api");
export const router = new Router();

export function getBlobDescriptor(blob: BlobMetadata, req?: Request) {
  return {
    sha256: blob.sha256,
    size: blob.size,
    uploaded: blob.uploaded,
    type: blob.type,
    url: getBlobURL(blob, req ? req.protocol + "://" + req.host : undefined),
  };
}

function parseAuthEvent(auth: NostrEvent) {
  const now = dayjs().unix();
  if (auth.kind !== 24242) throw new HttpErrors.BadRequest("Unexpected auth kind");

  // BUD-11: created_at MUST be in the past
  if (auth.created_at > now) throw new HttpErrors.BadRequest("Auth event created_at is in the future");

  const type = auth.tags.find((t) => t[0] === "t")?.[1];
  if (!type) throw new HttpErrors.BadRequest("Auth missing type");
  const expiration = auth.tags.find((t) => t[0] === "expiration")?.[1];
  if (!expiration) throw new HttpErrors.BadRequest("Auth missing expiration");
  if (parseInt(expiration) < now) throw new HttpErrors.BadRequest("Auth expired");
  if (!verifyEvent(auth)) throw new HttpErrors.BadRequest("Invalid Auth event");

  // BUD-11: if server tags are present, this server's domain MUST appear in at least one
  const serverTags = auth.tags.filter((t: string[]) => t[0] === "server");
  if (serverTags.length > 0) {
    const domain = config.publicDomain ? new URL(config.publicDomain).hostname.toLowerCase() : undefined;
    if (!domain || !serverTags.some((t: string[]) => t[1] === domain))
      throw new HttpErrors.Unauthorized("Auth not valid for this server");
  }

  return { auth, type, expiration: parseInt(expiration) };
}

// parse auth headers
export type CommonState = { auth?: NostrEvent; authType?: string; authExpiration?: number };
router.use(async (ctx, next) => {
  const authStr = ctx.headers["authorization"] as string | undefined;

  if (authStr?.startsWith("Nostr ")) {
    // BUD-11: Authorization header uses Base64url encoding (RFC 4648 §5, no padding)
    const raw = authStr.replace(/^Nostr\s/i, "");
    const auth = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as NostrEvent;
    if (auth) {
      const { type, expiration } = parseAuthEvent(auth);
      ctx.state.auth = auth;
      ctx.state.authType = type;
      ctx.state.authExpiration = expiration;
    }
  }

  await next();
});
