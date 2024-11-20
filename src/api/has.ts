import { blobDB } from "../db/db.js";
import { router } from "./router.js";

router.head("/:hash", async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})/);
  if (!match) return next();

  const hash = match[1];
  const blob = blobDB.getBlob(hash);
  if (blob) {
    ctx.status = 200;

    // signal support for range requests
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests
    ctx.set("Accept-Ranges", "bytes");
    ctx.set("Content-Length", String(blob.size));
  } else ctx.status = 404;
});
