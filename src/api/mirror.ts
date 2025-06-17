import HttpErrors from "http-errors";
import { BlobMetadata } from "blossom-server-sdk";
import dayjs from "dayjs";
import { koaBody } from "koa-body";
import { IncomingMessage } from "http";
import mount from "koa-mount";
import followRedirects from "follow-redirects";
const { http, https } = followRedirects;

import storage from "../storage/index.js";
import { CommonState, getBlobDescriptor, log, router } from "./router.js";
import { getFileRule } from "../rules/index.js";
import { config } from "../config.js";
import { updateBlobAccess } from "../db/methods.js";
import { UploadDetails, readUpload, removeUpload, saveFromResponse } from "../storage/upload.js";
import { blobDB } from "../db/db.js";

function makeRequestWithAbort(url: URL) {
  return new Promise<{ response: IncomingMessage; controller: AbortController }>((res, rej) => {
    const cancelController = new AbortController();
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        signal: cancelController.signal,
      },
      (response) => {
        res({ response, controller: cancelController });
      },
    );
    request.on("error", (err) => rej(err));
    request.end();
  });
}

router.use(mount("/mirror", koaBody()));

router.put<CommonState>("/mirror", async (ctx) => {
  if (!config.upload.enabled) throw new HttpErrors.NotFound("Uploads disabled");

  // check auth
  if (config.upload.requireAuth) {
    if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
    if (ctx.state.authType !== "upload") throw new HttpErrors.Unauthorized("Auth event should be 'upload'");
  }

  if (!ctx.request.body?.url) throw new HttpErrors.BadRequest("Missing url");
  const downloadUrl = new URL(ctx.request.body.url);

  log(`Mirroring ${downloadUrl.toString()}`);

  const { response, controller } = await makeRequestWithAbort(downloadUrl);
  let maybeUpload: UploadDetails | undefined = undefined;

  try {
    if (!response.statusCode) throw new HttpErrors.InternalServerError("Failed to make request");
    if (response.statusCode < 200 || response.statusCode >= 400)
      throw new HttpErrors.InternalServerError("Download request failed");

    // check rules
    const contentType = response.headers["content-type"];
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

    const upload = (maybeUpload = await saveFromResponse(response));
    const type = contentType || upload.type;

    if (config.upload.requireAuth) {
      // check if auth has blob sha256 hash
      if (!ctx.state.auth?.tags.some((t) => t[0] === "x" && t[1] === upload.sha256))
        throw new HttpErrors.BadRequest("Auth missing blob sha256 hash");
    }

    let blob: BlobMetadata;

    if (!blobDB.hasBlob(upload.sha256)) {
      log("Saving", upload.sha256, type);
      await storage.writeBlob(upload.sha256, readUpload(upload), type);
      await removeUpload(upload);

      const now = dayjs().unix();
      blob = blobDB.addBlob({ sha256: upload.sha256, size: upload.size, type, uploaded: now });
      updateBlobAccess(upload.sha256, dayjs().unix());
    } else {
      blob = blobDB.getBlob(upload.sha256);
      await removeUpload(upload);
    }

    if (pubkey && !blobDB.hasOwner(upload.sha256, pubkey)) {
      blobDB.addOwner(blob.sha256, pubkey);
    }

    ctx.status = 200;
    ctx.body = getBlobDescriptor(blob, ctx.request);
  } catch (error) {
    // cancel the request if anything fails
    controller.abort();
    if (maybeUpload) await removeUpload(maybeUpload);

    throw error;
  }
});
