import HttpErrors from "http-errors";
import { BlobMetadata } from "blossom-server-sdk";
import dayjs from "dayjs";

import storage from "../storage/index.js";
import { CommonState, getBlobDescriptor, log, router, saveAuthToken } from "./router.js";
import { getFileRule } from "../rules/index.js";
import { config } from "../config.js";
import { hasUsedToken, updateBlobAccess } from "../db/methods.js";
import { UploadMetadata, readUpload, removeUpload, uploadWriteStream } from "../storage/upload.js";
import { blobDB } from "../db/db.js";

router.put<CommonState>("/upload", async (ctx) => {
  if (!config.upload.enabled) throw new HttpErrors.NotFound("Uploads disabled");

  // check auth
  if (config.upload.requireAuth) {
    if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
    if (ctx.state.authType !== "upload") throw new HttpErrors.Unauthorized("Auth event should be 'upload'");
    if (hasUsedToken(ctx.state.auth.id)) throw new HttpErrors.BadRequest("Auth event already used");
  }

  // check rules
  const contentType = ctx.header["content-type"];
  const pubkey = ctx.state.auth?.pubkey;
  const authHash = ctx.state.auth?.tags.find((t) => t[0] === "x")?.[1];

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

  let mimeType: string | undefined = undefined;
  let upload: UploadMetadata;

  if (ctx.request.body) {
    upload = await uploadWriteStream(ctx.req);
    mimeType = contentType || upload.type;
  } else throw new Error("Invalid upload");

  if (config.upload.requireAuth && upload.sha256 !== authHash) {
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

  if (pubkey && !blobDB.hasOwner(upload.sha256, pubkey)) {
    blobDB.addOwner(blob.sha256, pubkey);
  }

  if (ctx.state.auth) saveAuthToken(ctx.state.auth);

  ctx.status = 200;
  ctx.body = getBlobDescriptor(blob, ctx.request);
});
