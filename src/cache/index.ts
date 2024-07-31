import { BlobSearch, CachePointer } from "../types.js";
import storage from "../storage/index.js";
import db, { blobDB } from "../db/db.js";
import { config } from "../config.js";
import { getExpirationTime } from "../rules/index.js";
import dayjs from "dayjs";
import { BlobMetadata } from "blossom-server-sdk/metadata";
import { forgetBlobAccessed } from "../db/methods.js";
import { S3Storage } from "blossom-server-sdk/storage";
import logger from "../logger.js";

const log = logger.extend("cache");

export async function search(search: BlobSearch): Promise<CachePointer | undefined> {
  if (blobDB.hasBlob(search.hash) && (await storage.hasBlob(search.hash))) {
    const type = await storage.getBlobType(search.hash);
    log("Found", search.hash);
    return { type: "cache", hash: search.hash, mimeType: type };
  }
}

export function getRedirect(pointer: CachePointer) {
  const publicURL = config.storage.s3?.publicURL;
  if (storage instanceof S3Storage && publicURL) {
    const object = storage.objects.find((obj) => obj.name.startsWith(pointer.hash));
    if (object) return publicURL + object.name;
  }
}

export async function readPointer(pointer: CachePointer) {
  return await storage.readBlob(pointer.hash);
}

export async function prune() {
  const now = dayjs().unix();
  const checked = new Set<string>();

  for (const rule of config.storage.rules) {
    const expiration = getExpirationTime(rule, now);
    let blobs: (BlobMetadata & { pubkey: string; accessed: number | null })[] = [];

    if (rule.pubkeys?.length) {
      blobs = db
        .prepare(
          `
          SELECT blobs.*,owners.pubkey, accessed.timestamp as "accessed"
          FROM blobs
            LEFT JOIN owners ON owners.blob = blobs.sha256
            LEFT JOIN accessed ON accessed.blob = blobs.sha256
          WHERE
            blobs.type LIKE ? AND
            owners.pubkey IN (${Array.from(rule.pubkeys).fill("?").join(", ")})
        `,
        )
        .all(rule.type.replace("*", "%"), ...rule.pubkeys) as (BlobMetadata & {
        pubkey: string;
        accessed: number | null;
      })[];
    } else {
      blobs = db
        .prepare(
          `
          SELECT blobs.*,owners.pubkey, accessed.timestamp as "accessed"
          FROM blobs
            LEFT JOIN owners ON owners.blob = blobs.sha256
            LEFT JOIN accessed ON accessed.blob = blobs.sha256
          WHERE
            blobs.type LIKE ?
        `,
        )
        .all(rule.type.replace("*", "%")) as (BlobMetadata & {
        pubkey: string;
        accessed: number | null;
      })[];
    }

    let n = 0;
    for (const blob of blobs) {
      if (checked.has(blob.sha256)) continue;

      if ((blob.accessed || blob.uploaded) < expiration) {
        log("Removing", blob.sha256, blob.type, "because", rule);
        await blobDB.removeBlob(blob.sha256);
        if (await storage.hasBlob(blob.sha256)) await storage.removeBlob(blob.sha256);
        forgetBlobAccessed(blob.sha256);
      }

      n++;
      checked.add(blob.sha256);
    }
    if (n > 0) log("Checked", n, "blobs");
  }
}
