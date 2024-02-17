#!/bin/env node
import "websocket-polyfill";
import Koa from "koa";
import debug from "debug";
import serve from "koa-static";
import path from "node:path";
import { PassThrough } from "node:stream";

import * as fileStorage from "./storage/file.js";
import * as cdnDiscovery from "./discover/cdn.js";
import * as nostrDiscovery from "./discover/nostr.js";
import * as httpTransport from "./transport/http.js";
import { config } from "./config.js";
import { BlobPointer, BlobSearch } from "./types.js";
import { URLSearchParams } from "node:url";
import mime from "mime";

const log = debug("cdn");
const app = new Koa();

async function handlePointers(ctx: Koa.ParameterizedContext, pointers: BlobPointer[]) {
  for (const pointer of pointers) {
    try {
      if (pointer.type === "http") {
        const stream = await httpTransport.readHTTPPointer(pointer);
        if (pointer.mimeType) ctx.type = pointer.mimeType;
        const pass = (ctx.body = new PassThrough());
        stream.pipe(pass);

        fileStorage.saveFile(pointer.hash, stream, pointer.metadata);
        return true;
      }
    } catch (e) {}
  }

  return false;
}

app.use(async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})(\.[a-z]+)?/);
  if (!match) return next();

  const hash = match[1];
  const ext = match[2] || undefined;
  const searchParams = new URLSearchParams(ctx.search);

  const search: BlobSearch = {
    hash,
    ext,
    pubkey: searchParams.get("pubkey") ?? undefined,
  };

  log("Looking for", search.hash);

  const filePointer = await fileStorage.search(search);
  if (filePointer) {
    ctx.type = filePointer.ext;
    ctx.body = await fileStorage.readFilePointer(filePointer);
    return;
  }

  if (config.discovery.nostr.enabled) {
    let pointers = await nostrDiscovery.search(search);
    if (pointers.length) {
      const handled = await handlePointers(ctx, pointers);
      if (handled) return;
    }
  }

  if (config.discovery.upstream.enabled) {
    const cdnSource = await cdnDiscovery.search(search);
    if (cdnSource) {
      if (search.ext) ctx.type = search.ext;
      const pass = (ctx.body = new PassThrough());
      cdnSource.pipe(pass);
      fileStorage.saveFile(hash, cdnSource, {
        mimeType: ext ? mime.getType(ext) ?? undefined : undefined,
      });
    }
  }

  if (!ctx.body) {
    ctx.status = 404;
  }
});

app.use(serve(path.join(process.cwd(), "public")));

app.listen(3000);

setInterval(() => fileStorage.prune(), 1000 * 30);
