import debug from "debug";
import fs from "node:fs";
import pfs from "node:fs/promises";
import dayjs from "dayjs";

import { BlobSearch, CachePointer } from "../types.js";
import { db, setBlobMimetype, setBlobSize } from "../db.js";
import storage from "../storage/index.js";

const log = debug("cdn:cache");

export async function search(search: BlobSearch): Promise<CachePointer | undefined> {
  if (await storage.hasBlob(search.hash)) {
    const blob = await storage.findBlob(search.hash);
    if (!blob) return;
    log("Found", search.hash);
    return { type: "cache", hash: search.hash, mimeType: blob.mimeType };
  }
}

export function hasBlob(hash: string) {
  return !!db.data.blobs[hash];
}

export function getRedirect(pointer: CachePointer) {
  return storage.getPublicURL(pointer.hash);
}
export async function readPointer(pointer: CachePointer) {
  return await storage.readBlob(pointer.hash);
}

export async function saveBlob(hash: string, tempFile: string, mimeType?: string) {
  if (await storage.hasBlob(hash)) return;

  log("Saving", hash, mimeType);
  const { size } = await pfs.stat(tempFile);
  await storage.putBlob(hash, fs.createReadStream(tempFile), mimeType);
  await pfs.rm(tempFile);

  setBlobSize(hash, size);
  if (mimeType) setBlobMimetype(hash, mimeType);
}

export async function removeBlob(hash: string) {
  if (await storage.hasBlob(hash)) {
    log("Removing", hash);
    await storage.removeBlob(hash);
    delete db.data.blobs[hash];
  }
}

export async function prune() {
  const now = dayjs().unix();
  for (const [hash, metadata] of Object.entries(db.data.blobs)) {
    if (metadata.expiration && metadata.expiration < now) {
      await removeBlob(hash);
    }
  }
}
