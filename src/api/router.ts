import { Request } from "koa";
import Router from "@koa/router";
import dayjs from "dayjs";
import HttpErrors from "http-errors";
import { verifyEvent, NostrEvent } from "nostr-tools";
import { BlobMetadata } from "blossom-server-sdk";

import logger from "../logger.js";
import { getBlobURL } from "../helpers/blob.js";

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
  const type = auth.tags.find((t) => t[0] === "t")?.[1];
  if (!type) throw new HttpErrors.BadRequest("Auth missing type");
  const expiration = auth.tags.find((t) => t[0] === "expiration")?.[1];
  if (!expiration) throw new HttpErrors.BadRequest("Auth missing expiration");
  if (parseInt(expiration) < now) throw new HttpErrors.BadRequest("Auth expired");
  if (!verifyEvent(auth)) throw new HttpErrors.BadRequest("Invalid Auth event");

  return { auth, type, expiration: parseInt(expiration) };
}

// parse auth headers
export type CommonState = { auth?: NostrEvent; authType?: string; authExpiration?: number };
router.use(async (ctx, next) => {
  const authStr = ctx.headers["authorization"] as string | undefined;

  if (authStr?.startsWith("Nostr ")) {
    const auth = authStr ? (JSON.parse(atob(authStr.replace(/^Nostr\s/i, ""))) as NostrEvent) : undefined;
    if (auth) {
      const { type, expiration } = parseAuthEvent(auth);
      ctx.state.auth = auth;
      ctx.state.authType = type;
      ctx.state.authExpiration = expiration;
    }
  }

  await next();
});
