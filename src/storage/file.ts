import debug from "debug";
import { fileTypeFromFile } from "file-type";
import fs from "node:fs";
import pfs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { JSONFilePreset } from "lowdb/node";
import dayjs from "dayjs";
import { Readable } from "node:stream";
import mime from "mime";

import { BlobSearch, FilePointer, PointerMetadata } from "../types.js";
import { config } from "../config.js";
import { getFileRule } from "./rules.js";

const DATA_DIR = config.cache.dir;
const log = debug("cdn:cache");
const writeDir = await pfs.mkdtemp(path.join(tmpdir(), "cdn-"));

// hacky db
type DBSchema = {
  expiration: Record<string, number>;
};
const db = await JSONFilePreset<DBSchema>(path.join(DATA_DIR, "expiration.json"), {
  expiration: {},
});
db.data.expiration = db.data.expiration || {};
setInterval(() => db.write(), 1000);

const files = await pfs.readdir(DATA_DIR, { encoding: "utf8" });

export async function search(search: BlobSearch): Promise<FilePointer | null> {
  log("Looking for", search.hash);
  const file = files.find((f) => f.startsWith(search.hash));
  if (!file) return null;

  const [name, ext] = file.split(".");
  log("Found", file);
  return { type: "file", hash: search.hash, name, ext, pathname: file };
}

export async function readFilePointer(pointer: FilePointer) {
  log("Reading file", pointer.pathname);
  return fs.createReadStream(path.join(DATA_DIR, pointer.pathname));
}

const saving = new Set();
export async function saveFile(hash: string, stream: Readable, metadata?: PointerMetadata) {
  if (files.some((f) => f.startsWith(hash))) return;
  if (saving.has(hash)) return;
  log("Saving file", hash);
  saving.add(hash);

  const tmpFile = path.join(writeDir, hash);
  stream.pipe(fs.createWriteStream(tmpFile));
  stream.on("end", async () => {
    log("Downloaded", hash);
    let mimeType = metadata?.mimeType;
    const type = await fileTypeFromFile(tmpFile);
    if (type) {
      log("Detected type", type.mime);
      mimeType = type.mime;
    }

    const rule = getFileRule({
      hash,
      mimeType,
      pubkey: metadata?.pubkey,
    });
    if (!rule) {
      await pfs.rm(tmpFile);
      return;
    }

    log("Found rule:", rule.expiration);
    const match = rule.expiration.match(/(\d+)\s*(\w+)/);
    if (!match) throw new Error("Failed to parse expiration");
    const count = parseInt(match[1]);
    const unit = match[2];

    // @ts-expect-error
    db.data.expiration[hash] = dayjs().add(count, unit).unix();
    // TODO: verify hash

    const ext = mimeType ? mime.getExtension(mimeType) || "" : "";
    const filename = hash + (ext ? "." + ext : "");
    await pfs.rename(tmpFile, path.join(DATA_DIR, filename));
    files.push(filename);
    saving.delete(hash);
    log("Moved file to data dir", path.join(DATA_DIR, filename));
  });
}

export async function prune() {
  const now = dayjs().unix();
  for (const [hash, date] of Object.entries(db.data.expiration)) {
    if (date < now) {
      const file = files.find((f) => f.startsWith(hash));
      if (file) {
        log("Removing", file);
        await pfs.rm(path.join(DATA_DIR, file));
        files.splice(files.indexOf(file), 1);
        delete db.data.expiration[hash];
      }
    }
  }
}
