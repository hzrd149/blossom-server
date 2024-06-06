import { fileTypeFromFile } from "file-type";
import fs from "node:fs";
import pfs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import mime from "mime";
import followRedirects from "follow-redirects";
const { http, https } = followRedirects;

import logger from "../logger.js";
import { SplitStream } from "../helpers/stream.js";
import { IncomingMessage } from "node:http";

const log = logger.extend("uploads");
const tmpDir = await pfs.mkdtemp(path.join(tmpdir(), "uploads-"));

export type UploadMetadata = {
  id: string;
  type?: string;
  sha256: string;
  tempFile: string;
  size: number;
};

export function uploadWriteStream(stream: Readable) {
  const id = nanoid(8);
  log("Uploading", id);

  const tempFile = path.join(tmpDir, id);
  const write = fs.createWriteStream(tempFile);
  const hash = createHash("sha256");

  // const split = new SplitStream(write, hash);
  stream.pipe(write);
  stream.pipe(hash);

  return new Promise<UploadMetadata>((res) => {
    stream.on("end", async () => {
      log("Uploaded", id);
      const type = await fileTypeFromFile(tempFile);
      const size = (await pfs.stat(tempFile)).size;
      res({ id, type: type?.mime, tempFile: tempFile, sha256: hash.digest("hex"), size });
    });
  });
}

export function saveFromResponse(response: IncomingMessage, url?: URL): Promise<UploadMetadata> {
  const id = nanoid(8);

  const tempFile = path.join(tmpDir, id);
  const write = fs.createWriteStream(tempFile);
  const hash = createHash("sha256");

  return new Promise<UploadMetadata>((resolve, reject) => {
    let mimeType = response.headers["content-type"];
    if (!mimeType && url) mimeType = mime.getType(url.pathname) ?? undefined;

    // const split = new SplitStream(write, hash);
    response.pipe(write);
    response.pipe(hash);

    response.on("end", async () => {
      if (!mimeType) mimeType = (await fileTypeFromFile(tempFile))?.mime;

      const size = (await pfs.stat(tempFile)).size;
      const sha256 = hash.digest("hex");

      log(sha256, size, mimeType);

      resolve({ id, type: mimeType, tempFile: tempFile, sha256, size });
    });
  });
}

export function downloadFromURL(url: URL) {
  const id = nanoid(8);
  const backend = url.protocol === "https:" ? https : http;

  log("Downloading", id, "from", url.toString());

  const tempFile = path.join(tmpDir, id);
  const write = fs.createWriteStream(tempFile);
  const hash = createHash("sha256");

  return new Promise<UploadMetadata>((resolve, reject) => {
    const request = backend.get(url, (res) => {
      saveFromResponse(res, url)
        .then((blob) => resolve(blob))
        .catch((err) => reject(err));
      // if (!res.statusCode) return reject();
      // if (res.statusCode < 200 || res.statusCode >= 400) {
      //   res.destroy();
      //   reject(res);
      // }

      // let mimeType = res.headers["content-type"];
      // if (!mimeType) mimeType = mime.getType(url.pathname) ?? undefined;

      // // const split = new SplitStream(write, hash);
      // res.pipe(write);
      // res.pipe(hash);

      // res.on("end", async () => {
      //   if (!mimeType) mimeType = (await fileTypeFromFile(tempFile))?.mime;

      //   const size = (await pfs.stat(tempFile)).size;
      //   const sha256 = hash.digest("hex");

      //   log(sha256, size, mimeType);

      //   resolve({ id, type: mimeType, tempFile: tempFile, sha256, size });
      // });
    });

    request.on("error", (err) => reject(err));
    request.end();
  });
}

export function readUpload(upload: Pick<UploadMetadata, "tempFile">) {
  return fs.createReadStream(upload.tempFile);
}

export async function removeUpload(upload: Pick<UploadMetadata, "tempFile">) {
  await pfs.rm(upload.tempFile);
}
