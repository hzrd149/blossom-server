import HttpErrors from "http-errors";

import { CommonState, router, saveAuthToken } from "./router.js";
import { hasUsedToken } from "../db/methods.js";
import { blobDB } from "../db/db.js";

router.delete<CommonState>("/:hash", async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})(\.[a-z]+)?/);
  if (!match) return next();

  const hash = match[1];
  if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
  if (ctx.state.authType !== "delete") throw new HttpErrors.Unauthorized("Incorrect Auth type");
  if (!ctx.state.auth.tags.some((t) => t[0] === "x" && t[1] === hash))
    throw new HttpErrors.Unauthorized("Auth missing hash");
  if (hasUsedToken(ctx.state.auth.id)) throw new Error("Auth already used");

  // skip if blob dose not exist
  if (!blobDB.hasBlob(hash)) return;

  const pubkey = ctx.state.auth.pubkey;

  if (blobDB.hasOwner(hash, pubkey)) {
    blobDB.removeOwner(hash, pubkey);
    saveAuthToken(ctx.state.auth);
  }

  ctx.status = 200;
  ctx.body = { message: "Deleted" };
});
