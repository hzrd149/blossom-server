#!/bin/env node
import "websocket-polyfill";
import Koa from "koa";
import debug from "debug";
import serve from "koa-static";
import path, { extname } from "node:path";
import { PassThrough } from "node:stream";
import { URLSearchParams } from "node:url";
import mime from "mime";
import pfs from "node:fs/promises";
import { NostrEvent } from "@nostr-dev-kit/ndk";
import cors from "@koa/cors";
import Router from "@koa/router";

import { config } from "./config.js";
import { BlobSearch } from "./types.js";
import * as cacheModule from "./cache/index.js";
import * as cdnDiscovery from "./discover/upstream.js";
import * as nostrDiscovery from "./discover/nostr.js";
import * as httpTransport from "./transport/http.js";
import * as uploadModule from "./storage/upload.js";
import {
  addPubkeyToBlob,
  db,
  hasUsedToken,
  pruneUsedTokens,
  removePubkeyFromBlob,
  setBlobExpiration,
  setUsedToken,
} from "./db.js";
import { getExpirationTime, getFileRule } from "./rules/index.js";
import httpError from "http-errors";
import dayjs from "dayjs";

const log = debug("cdn");
const app = new Koa();
const router = new Router();

function getBlobURL(hash: string) {
  const mimeType = db.data.blobs[hash]?.mimeType;
  const ext = mimeType && mime.getExtension(mimeType);
  return new URL(hash + (ext ? "." + ext : ""), config.publicDomain).toString();
}

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

// parse auth headers
type CommonState = { auth?: NostrEvent; authType?: string; authExpiration?: number };
router.use(async (ctx, next) => {
  const authStr = ctx.headers["authorization"] as string | undefined;

  if (authStr?.startsWith("Nostr ")) {
    const auth = authStr ? (JSON.parse(atob(authStr.replace(/^Nostr\s/i, ""))) as NostrEvent) : undefined;
    ctx.state.auth = auth;

    const now = dayjs().unix();
    if (auth) {
      if (auth.kind !== 24242) throw new httpError.BadRequest("Unexpected auth kind");
      const type = auth.tags.find((t) => t[0] === "t")?.[1];
      if (!type) throw new httpError.BadRequest("Auth missing type");
      const expiration = auth.tags.find((t) => t[0] === "expiration")?.[1];
      if (!expiration) throw new httpError.BadRequest("Auth missing expiration");
      if (parseInt(expiration) < now) throw new httpError.BadRequest("Auth expired");

      ctx.state.authType = type;
      ctx.state.authExpiration = expiration;
    }
  }

  await next();
});

// upload blobs
router.put<CommonState>("/upload", async (ctx) => {
  if (!config.upload.enabled) throw new httpError.NotFound("Uploads disabled");

  // handle upload
  const contentType = ctx.header["content-type"];
  if (config.upload.requireAuth) {
    if (!ctx.state.auth) throw new httpError.Unauthorized("Missing Auth event");
    if (ctx.state.authType !== "upload") throw new httpError.Unauthorized("Auth event should be 'upload'");

    if (hasUsedToken(ctx.state.auth.id!)) throw new httpError.BadRequest("Auth event already used");
  }

  const pubkey = ctx.state.auth?.pubkey;
  const authSize = ctx.state.auth
    ? parseInt(ctx.state.auth.tags.find((t) => t[0] === "size")?.[1] || "NaN")
    : undefined;

  const rule = getFileRule(
    {
      mimeType: contentType,
      pubkey,
    },
    config.upload.rules,
  );
  if (!rule) throw new httpError.Unauthorized("No rule");

  const upload = await uploadModule.uploadWriteStream(ctx.req);
  const mimeType = contentType || upload.mimeType;

  if (config.upload.requireAuth && upload.size !== authSize) {
    await pfs.rm(upload.tempFile);
    throw new httpError.BadRequest("Incorrect upload size");
  }

  // save the file if its not already there
  if (!cacheModule.hasBlob(upload.hash)) {
    setBlobExpiration(upload.hash, getExpirationTime(rule));
    await cacheModule.saveBlob(upload.hash, upload.tempFile, mimeType);
  } else await uploadModule.removeUpload(upload);

  if (pubkey) addPubkeyToBlob(upload.hash, pubkey);

  if (ctx.state.auth) setUsedToken(ctx.state.auth.id!, ctx.state.authExpiration!);

  ctx.status = 200;
  ctx.body = {
    url: getBlobURL(upload.hash),
    created: db.data.blobs[upload.hash].created,
    sha256: upload.hash,
    type: mimeType,
    size: upload.size,
  };
});

// list blobs
router.get<CommonState>("/list/:pubkey", async (ctx) => {
  const { pubkey } = ctx.params;
  const query = ctx.query;

  const since = query.since ? parseInt(query.since as string) : null;
  const until = query.until ? parseInt(query.until as string) : null;

  if (config.list.requireAuth) {
    if (!ctx.state.auth) throw new httpError.Unauthorized("Missing Auth event");
    if (ctx.state.authType !== "list") throw new httpError.Unauthorized("Incorrect Auth type");
    if (config.list.allowListOthers === false && ctx.state.auth.pubkey !== pubkey)
      throw new httpError.Unauthorized("Cant list other pubkey blobs");
  }

  ctx.status = 200;
  ctx.body = Object.entries(db.data.blobs)
    .filter(([hash, blob]) => {
      if (since !== null && blob.created < since) return false;
      if (until !== null && blob.created > until) return false;
      return blob.pubkeys?.includes(pubkey);
    })
    .map(([sha256, blob]) => ({
      sha256,
      created: blob.created,
      url: getBlobURL(sha256),
      type: blob.mimeType,
      size: blob.size,
    }));
});

// delete blobs
router.delete<CommonState>("/:hash", async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})(\.[a-z]+)?/);
  if (!match) return next();

  const hash = match[1];
  if (!ctx.state.auth) throw new httpError.Unauthorized("Missing Auth event");
  if (ctx.state.authType !== "delete") throw new httpError.Unauthorized("Incorrect Auth type");
  if (!ctx.state.auth.tags.some((t) => t[0] === "x" && t[1] === hash))
    throw new httpError.Unauthorized("Auth missing hash");

  const pubkey = ctx.state.auth.pubkey;

  const blob = db.data.blobs[hash];
  if (!blob) throw new httpError.NotFound("Blob dose not exist");

  if (blob.pubkeys?.includes(pubkey)) {
    removePubkeyFromBlob(hash, pubkey);
    setUsedToken(ctx.state.auth.id!, ctx.state.authExpiration!);

    // if pubkey was the last owner of the file, remove it
    if (blob.pubkeys.length === 0) {
      await cacheModule.removeBlob(hash);
    }
  }
  ctx.status = 200;
  ctx.body = { message: "Deleted" };
});

// fetch blobs
router.get("/:hash", async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})/);
  if (!match) return next();

  const hash = match[1];
  const ext = extname(ctx.path) ?? undefined;
  const searchParams = new URLSearchParams(ctx.search);

  const search: BlobSearch = {
    hash,
    ext,
    mimeType: ext ? mime.getType(ext) ?? undefined : undefined,
    pubkey: searchParams.get("pubkey") ?? undefined,
  };

  log("Looking for", search.hash);

  const cachePointer = await cacheModule.search(search);
  if (cachePointer) {
    const redirect = cacheModule.getRedirect(cachePointer);
    if (redirect) return ctx.redirect(redirect);

    if (cachePointer.mimeType) ctx.type = cachePointer.mimeType;
    ctx.body = await cacheModule.readPointer(cachePointer);
    return;
  }

  if (config.discovery.nostr.enabled) {
    let pointers = await nostrDiscovery.search(search);
    if (pointers.length) {
      for (const pointer of pointers) {
        try {
          if (pointer.type === "http") {
            const stream = await httpTransport.readHTTPPointer(pointer);
            if (pointer.mimeType) ctx.type = pointer.mimeType;
            const pass = (ctx.body = new PassThrough());
            stream.pipe(pass);

            // save to cache
            const rule = getFileRule(
              { mimeType: pointer.mimeType, pubkey: pointer.metadata?.pubkey },
              config.cache.rules,
            );
            if (rule) {
              uploadModule.uploadWriteStream(stream).then((upload) => {
                if (upload.hash !== pointer.hash) return;
                setBlobExpiration(upload.hash, getExpirationTime(rule));
                cacheModule.saveBlob(upload.hash, upload.tempFile, pointer.metadata?.mimeType || upload.mimeType);
              });
            }
            return;
          }
        } catch (e) {}
      }
    }
  }

  if (config.discovery.upstream.enabled) {
    const cdnSource = await cdnDiscovery.search(search);
    if (cdnSource) {
      if (search.ext) ctx.type = search.ext;
      const pass = (ctx.body = new PassThrough());
      cdnSource.pipe(pass);

      // save to cache
      const rule = getFileRule({ mimeType: search.mimeType, pubkey: search.pubkey }, config.cache.rules);
      if (rule) {
        uploadModule.uploadWriteStream(cdnSource).then((upload) => {
          if (upload.hash !== search.hash) return;
          setBlobExpiration(upload.hash, getExpirationTime(rule));
          cacheModule.saveBlob(upload.hash, upload.tempFile, search.mimeType || upload.mimeType);
        });
      }
    }
  }

  if (!ctx.body) throw new httpError.NotFound("Cant find blob for hash");
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
