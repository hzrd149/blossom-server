import { fileTypeFromFile } from "file-type";
import fs from "node:fs";
import pfs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { IncomingMessage } from "node:http";
import mime from "mime";

import logger from "../logger.js";
import { getFileHash } from "../helpers/file.js";

const log = logger.extend("uploads");
const tmpDir = await pfs.mkdtemp(path.join(tmpdir(), "uploads-"));

export type UploadDetails = {
  type?: string;
  sha256: string;
  tempFile: string;
  size: number;
};

export function rmTempFile(path: string) {
  if (!path.startsWith("/tmp")) throw new Error("Path is not a temp file");
  try {
    fs.rmSync(path);
  } catch (error) {}
}

export function newTempFile(type?: string) {
  let filename = nanoid(8);
  if (type) filename += "." + mime.getExtension(type);

  return path.join(tmpDir, filename);
}

export function saveFromUploadRequest(message: IncomingMessage) {
  return new Promise<UploadDetails>((resolve, reject) => {
    let type = message.headers["content-type"];

    const tempFile = newTempFile(type);
    const write = fs.createWriteStream(tempFile);

    log("Starting", tempFile);

    message.pipe(write);
    message.on("error", (err) => {
      rmTempFile(tempFile);
      reject(err);
    });

    write.on("finish", async () => {
      try {
        type = type || (await fileTypeFromFile(tempFile))?.mime;

        const size = fs.statSync(tempFile).size;
        const sha256 = await getFileHash(tempFile);

        log("Finished", tempFile);
        resolve({ type, tempFile, sha256, size });
      } catch (error) {
        rmTempFile(tempFile);
        reject(error);
      }
    });
  });
}

export function saveFromResponse(response: IncomingMessage): Promise<UploadDetails> {
  return new Promise<UploadDetails>((resolve, reject) => {
    let type = response.headers["content-type"];

    const tempFile = newTempFile(type);
    const write = fs.createWriteStream(tempFile);

    response.pipe(write);
    response.on("error", (err) => reject(err));

    write.on("finish", async () => {
      if (!type) type = (await fileTypeFromFile(tempFile))?.mime;

      const size = (await pfs.stat(tempFile)).size;
      const sha256 = await getFileHash(tempFile);

      log(sha256, size, type);

      resolve({ type, tempFile, sha256, size });
    });
  });
}

export function readUpload(upload: Pick<UploadDetails, "tempFile">) {
  return fs.createReadStream(upload.tempFile);
}

export async function removeUpload(upload: Pick<UploadDetails, "tempFile">) {
  try {
    await pfs.rm(upload.tempFile);
  } catch (error) {}
}
