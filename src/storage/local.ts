import debug from "debug";
import pfs from "node:fs/promises";
import fs from "node:fs";
import mime from "mime";
import path from "node:path";
import { BlobStorage, CachedBlob } from "./interface.js";
import { Readable } from "node:stream";

export default class LocalStorage implements BlobStorage {
  dir: string;
  files: string[] = [];
  log = debug("cdn:storage:local");

  constructor(dir: string) {
    this.dir = dir;
  }
  async setup() {
    this.files = await pfs.readdir(this.dir);
  }
  async hasBlob(hash: string): Promise<boolean> {
    return this.files.some((name) => name.startsWith(hash));
  }
  async findBlob(hash: string): Promise<CachedBlob | undefined> {
    const file = this.files.find((f) => f.startsWith(hash));
    if (!file) return;

    const ext = path.extname(file);
    const type = ext ? mime.getType(ext) ?? undefined : undefined;

    return { hash, type };
  }
  async readBlob(hash: string) {
    const file = this.files.find((f) => f.startsWith(hash));
    if (!file) throw new Error("Missing blob");

    return fs.createReadStream(path.join(this.dir, file));
  }
  putBlob(hash: string, stream: Readable, mimeType?: string) {
    return new Promise<void>((res) => {
      const ext = mimeType ? mime.getExtension(mimeType) : null;
      const filename = hash + (ext ? "." + ext : "");
      stream.pipe(fs.createWriteStream(path.join(this.dir, filename)));
      stream.on("end", () => {
        this.log("Saved", filename);
        this.files.push(filename);
        res();
      });
    });
  }
  async removeBlob(hash: string) {
    const file = this.files.find((f) => f.startsWith(hash));
    if (!file) throw new Error("Missing blob");

    await pfs.rm(path.join(this.dir, file));
    this.files.splice(this.files.indexOf(file), 1);
    this.log("Removed", file);
  }
  getPublicURL(hash: string) {
    // local storage is not exposed publicly
    return undefined;
  }
}
