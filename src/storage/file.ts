import debug from "debug";
import { fileTypeFromFile } from "file-type";
import fs from "node:fs";
import pfs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import dayjs from "dayjs";
import { Readable } from "node:stream";
import mime from "mime";

import { BlobSearch, FilePointer, PointerMetadata } from "../types.js";
import { config } from "../config.js";
import { getExpirationTime, getFileRule } from "./rules.js";
import { db, setBlobExpiration, setBlobMimetype, setBlobSize } from "../db.js";

const DATA_DIR = config.cache.dir;
const log = debug("cdn:cache");
const tmpDir = await pfs.mkdtemp(path.join(tmpdir(), "cdn-"));

const files = await pfs.readdir(DATA_DIR, { encoding: "utf8" });

export async function search(search: BlobSearch): Promise<FilePointer | null> {
  const file = files.find((f) => f.startsWith(search.hash));
  if (!file) return null;

  const [name, ext] = file.split(".");
  log("Found", file);
  return { type: "file", hash: search.hash, name, ext, pathname: file };
}

export async function readFilePointer(pointer: FilePointer) {
  return fs.createReadStream(path.join(DATA_DIR, pointer.pathname));
}

const saving = new Set();
export async function saveFile(hash: string, stream: Readable, metadata?: PointerMetadata) {
  if (files.some((f) => f.startsWith(hash))) return;
  if (saving.has(hash)) return;
  log("Saving file", hash);
  saving.add(hash);

  const tmpFile = path.join(tmpDir, hash);
  stream.pipe(fs.createWriteStream(tmpFile));
  stream.on("end", async () => {
    log("Downloaded", hash);
    const size = (await pfs.stat(tmpFile)).size;
    let mimeType = metadata?.mimeType;
    const type = await fileTypeFromFile(tmpFile);
    if (type) {
      log("Detected type", type.mime);
      mimeType = type.mime;
    }

    const rule = getFileRule(
      {
        mimeType,
        pubkey: metadata?.pubkey,
      },
      config.cache.rules,
    );
    if (!rule) {
      await pfs.rm(tmpFile);
      return;
    }

    log("Found rule:", rule.expiration);
    // TODO: verify hash

    const filename = await saveTempFile(hash, tmpFile, mimeType);
    saving.delete(hash);
    log("Moved file to data dir", path.join(DATA_DIR, filename));

    setBlobExpiration(hash, getExpirationTime(rule));
    setBlobSize(hash, size);
    if (mimeType) setBlobMimetype(hash, mimeType);
  });
}

export async function saveTempFile(hash: string, tempFile: string, mimeType?: string) {
  const ext = mimeType ? mime.getExtension(mimeType) || "" : "";
  const filename = hash + (ext ? "." + ext : "");
  await pfs.rename(tempFile, path.join(DATA_DIR, filename));
  files.push(filename);
  return filename;
}

export async function prune() {
  const now = dayjs().unix();
  for (const [hash, metadata] of Object.entries(db.data.blobs)) {
    if (metadata.expiration && metadata.expiration < now) {
      const file = files.find((f) => f.startsWith(hash));
      if (file) {
        log("Removing", file);
        await pfs.rm(path.join(DATA_DIR, file));
        files.splice(files.indexOf(file), 1);
        delete db.data.blobs[hash];
      }
    }
  }
}
