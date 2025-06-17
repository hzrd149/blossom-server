import HttpErrors from "http-errors";
import fs from "fs";
import mime from "mime";

import { addFromUpload } from "../storage/index.js";
import { CommonState, getBlobDescriptor, router } from "./router.js";
import { config } from "../config.js";
import { removeUpload, saveFromUploadRequest, UploadDetails } from "../storage/upload.js";
import { blobDB } from "../db/db.js";
import { checkUpload, UploadState } from "./upload.js";
import { optimizeMedia } from "../optimize/index.js";
import { getFileHash } from "../helpers/file.js";

router.all<CommonState>(
  "/media",
  async (ctx, next) => {
    if (!config.media.enabled) throw new HttpErrors.NotFound("Media uploads disabled");
    return await next();
  },
  checkUpload("media", config.media),
);

router.head<UploadState>("/media", async (ctx) => {
  ctx.status = 200;
});

router.put<UploadState>("/media", async (ctx) => {
  let upload = await saveFromUploadRequest(ctx.req);

  try {
    // if auth is required, check to see if the sha256 is in the auth event
    if (
      config.media.requireAuth &&
      (!ctx.state.auth || !ctx.state.auth.tags.some((t) => t[0] === "x" && t[1] === upload.sha256))
    ) {
      throw new HttpErrors.BadRequest("Incorrect blob sha256");
    }

    // optimize the file
    const output = await optimizeMedia(upload.tempFile, { image: config.media.image, video: config.media.video });

    // remove original upload
    await removeUpload(upload);

    const type = mime.getType(output);
    if (!type) throw new Error("Fail to get optimized mime type");

    const optimizedUpload: UploadDetails = {
      type,
      size: fs.statSync(output).size,
      sha256: await getFileHash(output),
      tempFile: output,
    };

    // save the upload as a blob
    const blob = await addFromUpload(optimizedUpload, type);

    // remove uploads
    await removeUpload(optimizedUpload);

    // add owner
    if (ctx.state.auth?.pubkey && !blobDB.hasOwner(upload.sha256, ctx.state.auth.pubkey)) {
      blobDB.addOwner(blob.sha256, ctx.state.auth.pubkey);
    }

    ctx.status = 200;
    ctx.body = getBlobDescriptor(blob, ctx.request);
  } catch (error) {
    // upload failed, cleanup
    await removeUpload(upload);
    throw error;
  }
});
