import debug from "debug";
import { fileTypeFromStream } from "file-type";
import fs from "fs";
import pfs from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { JSONFilePreset } from "lowdb/node";
import dayjs from "dayjs";

const DATA_DIR = process.env.DATA_DIR;
const log = debug("cdn:files");
const writeDir = await pfs.mkdtemp(path.join(tmpdir(), "cdn-"));

// hacky db
const db = await JSONFilePreset(path.join(DATA_DIR, "expiration.json"), {
  expiration: {},
});
db.data.expiration = db.data.expiration || {};
setInterval(() => db.write(), 1000);

const files = await pfs.readdir(DATA_DIR, { encoding: "utf8" });

/**
 * find content by sha256 hash
 * @param {string} hash
 * @param {string|undefined} ext
 */
export async function findByHash(hash) {
  log("Looking for", hash);
  const file = files.find((f) => f.startsWith(hash));
  if (file) {
    const [name, ext] = file.split(".");
    log("Found", file);
    return { name, ext };
  }
  return null;
}

/**
 * get a read stream to a file
 * @param {string} hash
 */
export async function readFile(hash) {
  log("Reading file", hash);
  const file = files.find((f) => f.startsWith(hash));

  db.data.expiration[hash] = dayjs().add(1, "minute").unix();

  return fs.createReadStream(path.join(DATA_DIR, file));
}

/**
 *
 * @param {string} hash
 * @param {ReadableStream} stream
 * @returns fs.WriteStream
 */
export async function saveFile(hash, stream) {
  if (files.some((f) => f.startsWith(hash))) return;
  log("Saving file", hash);

  const tmpFile = path.join(writeDir, hash);
  stream.pipe(fs.createWriteStream(tmpFile));

  let ext = "";
  const type = await fileTypeFromStream(stream);
  if (type) {
    log("Detected type", type.mime);
    ext = type.ext;
  }

  stream.on("end", async () => {
    log("Downloaded", hash);
    db.data.expiration[hash] = dayjs().add(5, "minute").unix();
    // TODO: verify hash

    const filename = hash + (ext ? "." + ext : "");
    await pfs.rename(tmpFile, path.join(DATA_DIR, filename));
    files.push(filename);
  });
}

export async function prune() {
  const now = dayjs();
  log("Pruning files");
  for (const [hash, date] of Object.entries(db.data.expiration)) {
    if (dayjs.unix(date).isAfter(now)) {
      const file = files.find((f) => f.startsWith(hash));
      if (file) {
        log("Removing", file);
        await pfs.rm(path.join(DATA_DIR, file));
      }
      files.splice(files.indexOf(file), 1);
    }
  }
}
