import { blobDB } from "../db/db.js";
import { router } from "./router.js";

router.head("/:hash", async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})/);
  if (!match) return next();

  const hash = match[1];
  const has = blobDB.hasBlob(hash);
  if (has) ctx.status = 200;
  else ctx.status = 404;
});
