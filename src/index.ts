#!/usr/bin/env node
import "./polyfill.js";
import Koa from "koa";
import serve from "koa-static";
import path from "node:path";
import cors from "@koa/cors";
import mount from "koa-mount";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import router from "./api/index.js";
import logger from "./logger.js";
import { config } from "./config.js";
import { isHttpError } from "./helpers/error.js";
import db from "./db/db.js";
import { pruneStorage } from "./storage/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Koa();

// trust reverse proxy headers
app.proxy = true;

// set CORS headers
app.use(
  cors({
    origin: "*",
    allowMethods: "*",
    allowHeaders: "Authorization,*",
    exposeHeaders: "*",
    maxAge: 86400,
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
      ctx.set("X-Reason", status > 500 ? "Something went wrong" : err.message);
    } else {
      console.log(err);
      ctx.status = 500;
      ctx.set("X-Reason", "Something went wrong");
    }
  }
});

app.use(router.routes()).use(router.allowedMethods());

if (config.dashboard.enabled) {
  const { koaBody } = await import("koa-body");
  const { default: basicAuth } = await import("koa-basic-auth");
  const { default: adminApi } = await import("./admin-api/index.js");

  app.use(mount("/api", basicAuth({ name: config.dashboard.username, pass: config.dashboard.password })));
  app.use(mount("/api", koaBody()));
  app.use(mount("/api", adminApi.routes())).use(mount("/api", adminApi.allowedMethods()));
  app.use(mount("/admin", serve(path.resolve(__dirname, "../admin/dist"))));

  logger("Dashboard started with", config.dashboard.username, config.dashboard.password);
}

try {
  const www = path.resolve(process.cwd(), "public");
  fs.statSync(www);
  app.use(serve(www));
} catch (error) {
  const www = path.resolve(__dirname, "../public");
  app.use(serve(www));
}

app.listen(process.env.PORT || 3000);
logger("Started app on port", process.env.PORT || 3000);

async function cron() {
  try {
    await pruneStorage();
  } catch (error) {}
  setTimeout(cron, 30_000);
}

setTimeout(cron, 60_000);

async function shutdown() {
  logger("Saving database...");
  db.close();
  process.exit(0);
}

process.addListener("SIGTERM", shutdown);
process.addListener("SIGINT", shutdown);
