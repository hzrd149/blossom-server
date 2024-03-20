#!/bin/env node
import "websocket-polyfill";
import Koa from "koa";
import debug from "debug";
import serve from "koa-static";
import path from "node:path";
import cors from "@koa/cors";
import Router from "@koa/router";

import * as cacheModule from "./cache/index.js";
import { db, pruneUsedTokens } from "./db.js";
import httpError from "http-errors";
import router from "./api.js";

const log = debug("cdn");
const app = new Koa();

// set CORS headers
app.use(
  cors({
    origin: "*",
    allowMethods: "*",
    allowHeaders: "Authorization,*",
    exposeHeaders: "*",
  }),
);

// handle errors
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    if (err instanceof httpError.HttpError) {
      const status = (ctx.status = err.status || 500);
      if (status >= 500) console.error(err.stack);
      ctx.body = status > 500 ? { message: "Something went wrong" } : { message: err.message };
    } else {
      console.log(err);
      ctx.status = 500;
      ctx.body = { message: "Something went wrong" };
    }
  }
});

app.use(router.routes()).use(router.allowedMethods());
app.use(serve(path.join(process.cwd(), "public")));

app.listen(process.env.PORT || 3000);

setInterval(() => {
  cacheModule.prune();
  pruneUsedTokens();
}, 1000 * 30);

async function shutdown() {
  log("Saving database...");
  await db.write();
  process.exit(0);
}

process.addListener("SIGTERM", shutdown);
process.addListener("SIGINT", shutdown);
