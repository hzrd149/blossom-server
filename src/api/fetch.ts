import { extname } from "node:path";
import { PassThrough } from "node:stream";
import { URLSearchParams } from "node:url";
import dayjs from "dayjs";
import mime from "mime";
import HttpErrors from "http-errors";

import { config } from "../config.js";
import { BlobPointer, BlobSearch } from "../types.js";
import * as cacheModule from "../cache/index.js";
import * as upstreamDiscovery from "../discover/upstream.js";
import * as nostrDiscovery from "../discover/nostr.js";
import * as httpTransport from "../transport/http.js";
import * as uploadModule from "../storage/upload.js";
import { getFileRule } from "../rules/index.js";
import storage from "../storage/index.js";
import { updateBlobAccess } from "../db/methods.js";
import { blobDB } from "../db/db.js";
import { log, router } from "./router.js";

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
