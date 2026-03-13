import HttpErrors from "http-errors";

import { CommonState, log, router } from "./router.js";
import { forgetBlobAccessed } from "../db/methods.js";
import { blobDB } from "../db/db.js";
import { config } from "../config.js";
import storage from "../storage/index.js";

router.delete<CommonState>("/:hash", async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})(\.[a-z]+)?/);
  if (!match) return next();

  const sha256 = match[1];
  if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
  if (ctx.state.authType !== "delete") throw new HttpErrors.Unauthorized("Incorrect Auth type");
  if (!ctx.state.auth.tags.some((t) => t[0] === "x" && t[1] === sha256))
    throw new HttpErrors.Unauthorized("Auth missing hash");

  // skip if blob dose not exist
  if (!blobDB.hasBlob(sha256)) throw new HttpErrors.NotFound("Blob does not exist");

  const pubkey = ctx.state.auth.pubkey;

  if (blobDB.hasOwner(sha256, pubkey)) {
    blobDB.removeOwner(sha256, pubkey);

    if (config.storage.removeWhenNoOwners && blobDB.listOwners(sha256).length === 0) {
      log(`Removing ${sha256} because it has no owners`);
      await blobDB.removeBlob(sha256);
      if (await storage.hasBlob(sha256)) await storage.removeBlob(sha256);
      forgetBlobAccessed(sha256);
    }
  }

  ctx.status = 200;
  ctx.body = { message: "Deleted" };
});
