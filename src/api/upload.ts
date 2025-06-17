import { ParameterizedContext, Next, DefaultState } from "koa";
import HttpErrors from "http-errors";

import { addFromUpload } from "../storage/index.js";
import { CommonState, getBlobDescriptor, router } from "./router.js";
import { getFileRule } from "../rules/index.js";
import { config, Rule } from "../config.js";
import { removeUpload, saveFromUploadRequest } from "../storage/upload.js";
import { blobDB } from "../db/db.js";
import { isWhitelisted, fetchWhitelist } from '../whitelist.js';

export type UploadState = CommonState & {
  contentType: string;
  contentLength: string;
  rule: Rule;
};

export function checkUpload(
  authType: "upload" | "media",
  opts: { requireAuth: boolean; requirePubkeyInRule: boolean },
) {
  return async (ctx: ParameterizedContext<DefaultState & CommonState>, next: Next) => {
    if (ctx.method === "HEAD" || ctx.method === "PUT") {
      // check auth
      if (opts.requireAuth) {
        if (!ctx.state.auth) throw new HttpErrors.Unauthorized("Missing Auth event");
        if (ctx.state.authType !== authType) throw new HttpErrors.Unauthorized(`Auth event must be '${authType}'`);

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
        opts.requireAuth && opts.requirePubkeyInRule,
      );

      if (!rule) {
        if (opts.requirePubkeyInRule) throw new HttpErrors.Unauthorized("Pubkey not on whitelist");
        else throw new HttpErrors.Unauthorized(`Server dose not accept ${contentType} blobs`);
      }

      ctx.state.contentType = contentType;
      ctx.state.contentLength = contentLength;
      ctx.state.rule = rule;
    }

    return await next();
  };
}

router.all<CommonState>(
  "/upload",
  async (ctx, next) => {
    if (!config.upload.enabled) throw new HttpErrors.NotFound("Uploads disabled");
    return await next();
  },
  checkUpload("upload", config.upload),
);
router.head<UploadState>("/upload", async (ctx) => {
  ctx.status = 200;
});

router.put<UploadState>("/upload", async (ctx) => {
  if (!config.upload.enabled) throw new HttpErrors.NotFound("Uploads disabled");

  const pubkey = ctx.state.auth?.pubkey;
  if (!pubkey) throw new HttpErrors.Unauthorized("Missing public key");

  await fetchWhitelist(); // Ensure the whitelist is up-to-date

  if (config.whitelist.enabled && pubkey && !isWhitelisted(pubkey)) {
    throw new HttpErrors.Forbidden(config.whitelist.errorMessage);
  }

  const { contentType } = ctx.state;

  let upload = await saveFromUploadRequest(ctx.req);
  let type = contentType || upload.type;

  try {
    // if auth is required, check to see if the sha256 is in the auth event
    if (
      config.upload.requireAuth &&
      (!ctx.state.auth || !ctx.state.auth.tags.some((t) => t[0] === "x" && t[1] === upload.sha256))
    ) {
      throw new HttpErrors.BadRequest("Incorrect blob sha256");
    }

    const blob = await addFromUpload(upload, type);

    // add owner
    if (pubkey && !blobDB.hasOwner(upload.sha256, pubkey)) {
      blobDB.addOwner(blob.sha256, pubkey);
    }

    ctx.status = 200;
    ctx.body = getBlobDescriptor(blob, ctx.request);
  } catch (error) {
    // upload failed, cleanup temp file
    await removeUpload(upload);
    throw error;
  }
});
