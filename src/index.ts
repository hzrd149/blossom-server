#!/bin/env node
import "websocket-polyfill";
import Koa from "koa";
import serve from "koa-static";
import path from "node:path";
import cors from "@koa/cors";
import mount from "koa-mount";

import "./db/old-db-migration.js";

import * as cacheModule from "./cache/index.js";
import router from "./api.js";
import logger from "./logger.js";
import { config } from "./config.js";
import { isHttpError } from "./helpers/error.js";

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
    if (isHttpError(err)) {
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

if (config.dashboard.enabled) {
  const { koaBody } = await import("koa-body");
  const { default: basicAuth } = await import("koa-basic-auth");
  const { default: adminApi } = await import("./admin-api/index.js");

  app.keys = [config.dashboard.sessionKey];
  app.use(mount("/api", basicAuth({ name: config.dashboard.username, pass: config.dashboard.password })));
  app.use(mount("/api", koaBody()));
  app.use(mount("/api", adminApi.routes())).use(mount("/api", adminApi.allowedMethods()));
  app.use(mount("/admin", serve("admin/dist")));

  logger("Dashboard started with", config.dashboard.username, config.dashboard.password);
}

app.use(serve(path.join(process.cwd(), "public")));

app.listen(process.env.PORT || 3000);
logger("Started app on port", process.env.PORT || 3000);

setInterval(() => {
  cacheModule.prune();
}, 1000 * 30);

async function shutdown() {
  logger("Saving database...");
  process.exit(0);
}

process.addListener("SIGTERM", shutdown);
process.addListener("SIGINT", shutdown);
