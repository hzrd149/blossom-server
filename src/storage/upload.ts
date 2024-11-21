import { fileTypeFromFile } from "file-type";
import fs from "node:fs";
import pfs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import mime from "mime";
import { IncomingMessage } from "node:http";
import followRedirects from "follow-redirects";
const { http, https } = followRedirects;

import logger from "../logger.js";
import { getFileHash } from "../helpers/file.js";

const log = logger.extend("uploads");
const tmpDir = await pfs.mkdtemp(path.join(tmpdir(), "uploads-"));

export type UploadDetails = {
  id: string;
  type?: string;
  sha256: string;
  tempFile: string;
  size: number;
};

export function uploadWriteStream(stream: Readable) {
  return new Promise<UploadDetails>((resolve, reject) => {
    const id = nanoid(8);
    log("starting", id);

    const tempFile = path.join(tmpDir, id);
    const write = fs.createWriteStream(tempFile);

    stream.pipe(write);
    stream.on("error", (err) => {
      fs.rmSync(tempFile);
      reject(err);
    });
    stream.on("end", async () => {
      try {
        log("finished", id);

        const size = fs.statSync(tempFile).size;
        const type = await fileTypeFromFile(tempFile);
        const sha256 = await getFileHash(tempFile);

        resolve({ id, type: type?.mime, tempFile, sha256, size });
      } catch (error) {
        fs.rmSync(tempFile);
        reject(error);
      }
    });
  });
}

export function saveFromResponse(response: IncomingMessage): Promise<UploadDetails> {
  const id = nanoid(8);

  const tempFile = path.join(tmpDir, id);
  const write = fs.createWriteStream(tempFile);

  return new Promise<UploadDetails>((resolve, reject) => {
    let type = response.headers["content-type"];

    response.pipe(write);
    response.on("error", (err) => reject(err));
    response.on("end", async () => {
      if (!type) type = (await fileTypeFromFile(tempFile))?.mime;

      const size = (await pfs.stat(tempFile)).size;
      const sha256 = await getFileHash(tempFile);

      log(sha256, size, type);

      resolve({ id, type, tempFile, sha256, size });
    });
  });
}

export function downloadFromURL(url: URL) {
  const backend = url.protocol === "https:" ? https : http;

  log("Downloading from", url.toString());

  return new Promise<UploadDetails>((resolve, reject) => {
    const request = backend.get(url, (res) => {
      saveFromResponse(res)
        .then((blob) => resolve(blob))
        .catch((err) => reject(err));
    });

    request.on("error", (err) => reject(err));
    request.end();
  });
}

export function readUpload(upload: Pick<UploadDetails, "tempFile">) {
  return fs.createReadStream(upload.tempFile);
}

export async function removeUpload(upload: Pick<UploadDetails, "tempFile">) {
  await pfs.rm(upload.tempFile);
}
