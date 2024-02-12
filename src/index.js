import "websocket-polyfill";
import "dotenv/config.js";
import Koa from "koa";
import debug from "debug";
import serve from "koa-static";
import path from "path";

import * as fileStorage from "./storage/file.js";
import * as cdnDiscovery from "./discover/cdn.js";
import * as nostrDiscovery from "./discover/nostr.js";
import * as httpTransport from "./transport/http.js";
import { PassThrough } from "stream";

const log = debug("cdn");
const app = new Koa();

// response
app.use(async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})(\.[a-z]+)?/);

  if (!match) return next();

  const hash = match[1];
  const ext = match[2] || "";

  log("Looking for", hash);

  const file = await fileStorage.findByHash(hash);
  if (file) {
    ctx.type = file.ext;
    ctx.body = await fileStorage.readFile(hash);
    return;
  }

  const info = await nostrDiscovery.findByHash(hash, ext);
  if (info) {
    if (info.url) {
      ctx.type = info.mimeType || ext;
      for (const url of info.urls) {
        const stream = await httpTransport.getReadStream(url);
        if (stream) {
          // ctx.redirect(url)
          // stream it back
          ctx.body = new PassThrough();
          stream.pipe(ctx.body);

          // save the file
          fileStorage.saveFile(hash, stream);
          break;
        }
      }
    }
  } else {
    const cdnSource = await cdnDiscovery.findByHash(hash, ext);
    if (cdnSource) {
      if (ext) ctx.type = ext;
      ctx.body = new PassThrough();
      cdnSource.pipe(ctx.body);
      fileStorage.saveFile(hash, cdnSource);
    }
  }

  if (!ctx.body) {
    ctx.status = 404;
  }
});

app.use(serve(path.join(process.cwd(), "public")));

app.listen(3000);

setInterval(() => fileStorage.prune(), 1000 * 30);
