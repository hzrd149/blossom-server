import debug from "debug";

import { BlobSearch, CachePointer } from "../types.js";
import storage from "../storage/index.js";
import db, { blobDB } from "../db/db.js";
import { config } from "../config.js";
import { getExpirationTime } from "../rules/index.js";
import dayjs from "dayjs";
import { BlobRow } from "blossom-sqlite";
import { forgetBlobAccessed } from "../db/methods.js";

const log = debug("cdn:cache");

export async function search(search: BlobSearch): Promise<CachePointer | undefined> {
  if (blobDB.hasBlob(search.hash) && (await storage.hasBlob(search.hash))) {
    const blob = await storage.findBlob(search.hash);
    if (!blob) return;
    log("Found", search.hash);
    return { type: "cache", hash: search.hash, mimeType: blob.type };
  }
}

export function getRedirect(pointer: CachePointer) {
  return storage.getPublicURL(pointer.hash);
}
export async function readPointer(pointer: CachePointer) {
  return await storage.readBlob(pointer.hash);
}

export async function prune() {
  const now = dayjs().unix();
  const checked = new Set<string>();

  for (const rule of config.storage.rules) {
    const expiration = getExpirationTime(rule, now);
    let blobs: (BlobRow & { pubkey: string; accessed: number | null })[] = [];

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
        .all(rule.type.replace("*", "%"), ...rule.pubkeys) as (BlobRow & {
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
        .all(rule.type.replace("*", "%")) as (BlobRow & {
        pubkey: string;
        accessed: number | null;
      })[];
    }

    let n = 0;
    for (const blob of blobs) {
      if (checked.has(blob.sha256)) continue;

      if ((blob.accessed || blob.created) < expiration) {
        log("Removing", blob.sha256, blob.type, "because", rule);
        blobDB.removeBlob(blob.sha256);
        if (await storage.hasBlob(blob.sha256)) storage.removeBlob(blob.sha256);
        forgetBlobAccessed(blob.sha256);
      }

      n++;
      checked.add(blob.sha256);
    }
    if (n > 0) log("Checked", n, "blobs");
  }
}
