#!/bin/env node
import { extname } from "node:path";
import { PassThrough } from "node:stream";
import { URLSearchParams } from "node:url";
import { verifyEvent, NostrEvent } from "nostr-tools";
import { BlobMetadata } from "blossom-server-sdk/metadata";
import Router from "@koa/router";
import dayjs from "dayjs";
import mime from "mime";
import { Request } from "koa";
import HttpErrors from "http-errors";

import { config } from "./config.js";
import { BlobPointer, BlobSearch } from "./types.js";
import * as cacheModule from "./cache/index.js";
import * as upstreamDiscovery from "./discover/upstream.js";
import * as nostrDiscovery from "./discover/nostr.js";
import * as httpTransport from "./transport/http.js";
import * as uploadModule from "./storage/upload.js";
import { getFileRule } from "./rules/index.js";
import storage from "./storage/index.js";
import { addToken, hasUsedToken, updateBlobAccess } from "./db/methods.js";
import { blobDB } from "./db/db.js";
import { getBlobURL } from "./helpers/blob.js";
import logger from "./logger.js";

function getBlobDescriptor(blob: BlobMetadata, req?: Request) {
  return {
    sha256: blob.sha256,
    size: blob.size,
    uploaded: blob.uploaded,
    type: blob.type,
    url: getBlobURL(blob, req ? req.protocol + "://" + req.host : undefined),
  };
}

const log = logger.extend("api");
const router = new Router();

function parseAuthEvent(auth: NostrEvent) {
  const now = dayjs().unix();
  if (auth.kind !== 24242) throw new HttpErrors.BadRequest("Unexpected auth kind");
  const type = auth.tags.find((t) => t[0] === "t")?.[1];
  if (!type) throw new HttpErrors.BadRequest("Auth missing type");
  const expiration = auth.tags.find((t) => t[0] === "expiration")?.[1];
  if (!expiration) throw new HttpErrors.BadRequest("Auth missing expiration");
  if (parseInt(expiration) < now) throw new HttpErrors.BadRequest("Auth expired");
  if (!verifyEvent(auth)) throw new HttpErrors.BadRequest("Invalid Auth event");

  return { auth, type, expiration: parseInt(expiration) };
}
function saveAuthToken(event: NostrEvent) {
  const { expiration, type } = parseAuthEvent(event);
  addToken({
    id: event.id,
    expiration: expiration,
    type: type,
    event,
  });
}

// parse auth headers
type CommonState = { auth?: NostrEvent; authType?: string; authExpiration?: number };
router.use(async (ctx, next) => {
  const authStr = ctx.headers["authorization"] as string | undefined;

  if (authStr?.startsWith("Nostr ")) {
    const auth = authStr ? (JSON.parse(atob(authStr.replace(/^Nostr\s/i, ""))) as NostrEvent) : undefined;
    if (auth) {
      const { type, expiration } = parseAuthEvent(auth);
      ctx.state.auth = auth;
      ctx.state.authType = type;
      ctx.state.authExpiration = expiration;
    }
  }

  await next();
});

// upload blobs
router.put<CommonState>("/upload", async (ctx) => {
  if (!config.upload.enabled) throw new HttpErrors.NotFound("Uploads disabled");

  // handle upload
  const contentType = ctx.header["content-type"];
  if (config.upload.requireAuth) {
    if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
    if (ctx.state.authType !== "upload") throw new HttpErrors.Unauthorized("Auth event should be 'upload'");

    if (hasUsedToken(ctx.state.auth.id)) throw new HttpErrors.BadRequest("Auth event already used");
  }

  const pubkey = ctx.state.auth?.pubkey;
  const authSize = ctx.state.auth
    ? parseInt(ctx.state.auth.tags.find((t) => t[0] === "size")?.[1] || "NaN")
    : undefined;

  const rule = getFileRule(
    {
      type: contentType,
      pubkey,
    },
    config.storage.rules,
    config.upload.requireAuth && config.upload.requirePubkeyInRule,
  );
  if (!rule) {
    if (config.upload.requirePubkeyInRule) throw new HttpErrors.Unauthorized("Pubkey not on whitelist");
    else throw new HttpErrors.Unauthorized(`Server dose not accept ${contentType} blobs`);
  }

  const upload = await uploadModule.uploadWriteStream(ctx.req);
  const mimeType = contentType || upload.type || "";

  if (config.upload.requireAuth && upload.size !== authSize) {
    uploadModule.removeUpload(upload);
    throw new HttpErrors.BadRequest("Incorrect upload size");
  }

  let blob: BlobMetadata;

  if (!blobDB.hasBlob(upload.sha256)) {
    log("Saving", upload.sha256, mimeType);
    await storage.writeBlob(upload.sha256, uploadModule.readUpload(upload), mimeType);
    await uploadModule.removeUpload(upload);

    const now = dayjs().unix();
    blob = blobDB.addBlob({ sha256: upload.sha256, size: upload.size, type: mimeType, uploaded: now });
    updateBlobAccess(upload.sha256, dayjs().unix());
  } else {
    blob = blobDB.getBlob(upload.sha256);
    await uploadModule.removeUpload(upload);
  }

  if (pubkey && !blobDB.hasOwner(upload.sha256, pubkey)) {
    blobDB.addOwner(blob.sha256, pubkey);
  }

  if (ctx.state.auth) saveAuthToken(ctx.state.auth);

  ctx.status = 200;
  ctx.body = getBlobDescriptor(blob, ctx.request);
});

// list blobs
router.get<CommonState>("/list/:pubkey", async (ctx) => {
  const { pubkey } = ctx.params;
  const query = ctx.query;

  const since = query.since ? parseInt(query.since as string) : undefined;
  const until = query.until ? parseInt(query.until as string) : undefined;

  if (config.list.requireAuth) {
    if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
    if (ctx.state.authType !== "list") throw new HttpErrors.Unauthorized("Incorrect Auth type");
    if (config.list.allowListOthers === false && ctx.state.auth.pubkey !== pubkey)
      throw new HttpErrors.Unauthorized("Cant list other pubkeys blobs");
  }

  const blobs = await blobDB.getOwnerBlobs(pubkey, { since, until });

  ctx.status = 200;
  ctx.body = blobs.map((blob) => getBlobDescriptor(blob, ctx.request));
});

// delete blobs
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

// has blobs
router.head("/:hash", async (ctx, next) => {
  const match = ctx.path.match(/([0-9a-f]{64})/);
  if (!match) return next();

  const hash = match[1];
  const has = blobDB.hasBlob(hash);
  if (has) ctx.status = 200;
  else ctx.status = 404;
  ctx.body = null;
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
    updateBlobAccess(search.hash, dayjs().unix());

    const redirect = cacheModule.getRedirect(cachePointer);
    if (redirect) return ctx.redirect(redirect);

    if (cachePointer.mimeType) ctx.type = cachePointer.mimeType;
    ctx.body = await cacheModule.readPointer(cachePointer);
    return;
  }

  // we don't have the blob, go looking for it
  const pointers: BlobPointer[] = [];

  if (config.discovery.nostr.enabled) {
    let nostrPointers = await nostrDiscovery.search(search);
    for (const pointer of nostrPointers) pointers.push(pointer);
  }

  if (config.discovery.upstream.enabled) {
    const cdnPointer = await upstreamDiscovery.search(search);
    if (cdnPointer) pointers.push(cdnPointer);
  }

  // download it from pointers if any where found
  for (const pointer of pointers) {
    try {
      if (pointer.type === "http") {
        const stream = await httpTransport.readHTTPPointer(pointer);

        // set mime type
        if (!ctx.type && pointer.mimeType) ctx.type = pointer.mimeType;
        if (!ctx.type && search.mimeType) ctx.type = search.mimeType;

        const pass = (ctx.body = new PassThrough());
        stream.pipe(pass);

        // save to cache
        const rule = getFileRule(
          { type: pointer.mimeType || search.mimeType, pubkey: pointer.metadata?.pubkey || search.pubkey },
          config.storage.rules,
        );
        if (rule) {
          // save the blob in the background (no await)
          uploadModule.uploadWriteStream(stream).then(async (upload) => {
            if (upload.sha256 !== pointer.hash) return;

            // if the storage dose not have the blob. upload it
            if (!(await storage.hasBlob(upload.sha256))) {
              const type = upload.type || pointer.mimeType || search.mimeType || "";
              await storage.writeBlob(upload.sha256, uploadModule.readUpload(upload), type);
              await uploadModule.removeUpload(upload);

              if (!blobDB.hasBlob(upload.sha256)) {
                blobDB.addBlob({ sha256: upload.sha256, size: upload.size, type, uploaded: dayjs().unix() });
              }
            } else {
              await uploadModule.removeUpload(upload);
            }
          });
        }

        return;
      }
    } catch (e) {}
  }

  if (!ctx.body) throw new HttpErrors.NotFound("Cant find blob for hash");
});

export default router;
