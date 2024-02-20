import debug from "debug";
import { fileTypeFromFile } from "file-type";
import fs from "node:fs";
import pfs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";

const log = debug("cdn:upload");
const tmpDir = await pfs.mkdtemp(path.join(tmpdir(), "uploads-"));

export type UploadMetadata = {
  mimeType?: string;
  hash: string;
  tempFile: string;
  size: number;
};

export function uploadWriteStream(stream: Readable) {
  const id = nanoid(8);
  log("Uploading", id);

  const tempFile = path.join(tmpDir, id);
  const write = fs.createWriteStream(tempFile);
  stream.pipe(write);

  const hash = createHash("sha256");
  stream.pipe(hash);

  return new Promise<UploadMetadata>((res) => {
    stream.on("end", async () => {
      log("Uploaded", id);
      const type = await fileTypeFromFile(tempFile);
      const size = await (await pfs.stat(tempFile)).size;
      res({ mimeType: type?.mime, tempFile: tempFile, hash: hash.digest("hex"), size });
    });
  });
}

export async function removeUpload(upload: { tempFile: string }) {
  await pfs.rm(upload.tempFile);
}
