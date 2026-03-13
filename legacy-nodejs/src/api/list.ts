import HttpErrors from "http-errors";

import { config } from "../config.js";
import { CommonState, getBlobDescriptor, router } from "./router.js";
import { blobDB } from "../db/db.js";

router.get<CommonState>("/list/:pubkey", async (ctx) => {
  const { pubkey } = ctx.params;
  const query = ctx.query;

  const since = query.since ? parseInt(query.since as string) : undefined;
  const until = query.until ? parseInt(query.until as string) : undefined;

  if (config.list.requireAuth) {
    if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
    if (ctx.state.authType !== "list") throw new HttpErrors.Unauthorized("Incorrect Auth type");
    if (config.list.allowListOthers === false && ctx.state.auth.pubkey !== pubkey)
      throw new HttpErrors.Unauthorized("Cant list other pubkeys blobs");
  }

  const blobs = await blobDB.getOwnerBlobs(pubkey, { since, until });

  ctx.status = 200;
  ctx.body = blobs.map((blob) => getBlobDescriptor(blob, ctx.request));
});
