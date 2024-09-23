import HttpErrors from "http-errors";
import { BlobMetadata } from "blossom-server-sdk";
import dayjs from "dayjs";

import storage from "../storage/index.js";
import { CommonState, getBlobDescriptor, log, router, saveAuthToken } from "./router.js";
import { getFileRule } from "../rules/index.js";
import { config, Rule } from "../config.js";
import { hasUsedToken, updateBlobAccess } from "../db/methods.js";
import { readUpload, removeUpload, uploadWriteStream } from "../storage/upload.js";
import { blobDB } from "../db/db.js";
import { isHttpError } from "../helpers/error.js";

type UploadState = CommonState & {
  contentType: string;
  contentLength: string;
  rule: Rule;
};

// handle errors
router.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    // BUD-06 set `X-Upload-Message` on failure
    if (isHttpError(err)) {
      const status = (ctx.status = err.status || 500);
      ctx.set("X-Upload-Message", status > 500 ? "Something went wrong" : err.message);
    } else {
      ctx.set("X-Upload-Message", "Something went wrong");
    }

    // pass error to parent handler
    throw err;
  }
});

router.all<CommonState>("/upload", async (ctx, next) => {
  if (!config.upload.enabled) throw new HttpErrors.NotFound("Uploads disabled");

  if (ctx.method === "HEAD" || ctx.method === "PUT") {
    // check auth
    if (config.upload.requireAuth) {
      if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
      if (ctx.state.authType !== "upload") throw new HttpErrors.Unauthorized("Auth event should be 'upload'");
      if (hasUsedToken(ctx.state.auth.id)) throw new HttpErrors.BadRequest("Auth event already used");

      // BUD-06, check if hash is in auth event
      const sha256 = ctx.header["x-sha-256"];
      if (typeof sha256 === "string" && !ctx.state.auth.tags.some((t) => t[0] === "x" && t[1] === sha256)) {
        throw new HttpErrors.BadRequest("Auth missing sha256");
      }
    }

    // check rules
    const contentType = ctx.header["content-type"] || String(ctx.header["x-content-type"]);
    let contentLength: number | undefined = undefined;
    if (typeof ctx.header["x-content-length"] === "string") {
      contentLength = parseInt(ctx.header["x-content-length"]);
    } else if (ctx.header["content-length"]) {
      contentLength = parseInt(ctx.header["content-length"]);
    }

    const pubkey = ctx.state.auth?.pubkey;
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

    ctx.state.contentType = contentType;
    ctx.state.contentLength = contentLength;
    ctx.state.rule = rule;
  }

  return await next();
});

router.head<UploadState>("/upload", async (ctx) => {
  ctx.status = 200;
});

router.put<UploadState>("/upload", async (ctx) => {
  const { contentType } = ctx.state;

  let upload = await uploadWriteStream(ctx.req);
  let mimeType = contentType || upload.type;

  // if auth is required, check to see if the sha256 is in the auth event
  if (
    config.upload.requireAuth &&
    (!ctx.state.auth || !ctx.state.auth.tags.some((t) => t[0] === "x" && t[1] === upload.sha256))
  ) {
    removeUpload(upload);
    throw new HttpErrors.BadRequest("Incorrect blob sha256");
  }

  let blob: BlobMetadata;

  if (!blobDB.hasBlob(upload.sha256)) {
    log("Saving", upload.sha256, mimeType);
    await storage.writeBlob(upload.sha256, readUpload(upload), mimeType);
    await removeUpload(upload);

    const now = dayjs().unix();
    blob = blobDB.addBlob({ sha256: upload.sha256, size: upload.size, type: mimeType, uploaded: now });
    updateBlobAccess(upload.sha256, dayjs().unix());
  } else {
    blob = blobDB.getBlob(upload.sha256);
    await removeUpload(upload);
  }

  if (ctx.state.auth?.pubkey && !blobDB.hasOwner(upload.sha256, ctx.state.auth.pubkey)) {
    blobDB.addOwner(blob.sha256, ctx.state.auth.pubkey);
  }

  if (ctx.state.auth) saveAuthToken(ctx.state.auth);

  ctx.status = 200;
  ctx.body = getBlobDescriptor(blob, ctx.request);
});
