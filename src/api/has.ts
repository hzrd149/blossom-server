import { blobDB } from "../db/db.js";
import { router } from "./router.js";

router.head("/:hash", async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})/);
  if (!match) return next();

  const hash = match[1];
  const blob = blobDB.getBlob(hash);
  if (blob) {
    // signal support for range requests
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests
    if (blob.type) ctx.type = blob.type;
    ctx.length = blob.size;
    ctx.status = 200;
  } else ctx.status = 404;
});
