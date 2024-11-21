import { mkdirp } from "mkdirp";
import { config } from "../config.js";
import { LocalStorage, S3Storage, IBlobStorage } from "blossom-server-sdk/storage";
import { BlobSearch, StoragePointer } from "../types.js";
import db, { blobDB } from "../db/db.js";
import logger from "../logger.js";
import dayjs from "dayjs";
import { getExpirationTime } from "../rules/index.js";
import { BlobMetadata } from "blossom-server-sdk";
import { forgetBlobAccessed } from "../db/methods.js";

async function createStorage() {
  if (config.storage.backend === "local") {
    await mkdirp(config.storage.local!.dir);
    return new LocalStorage(config.storage.local!.dir);
  } else if (config.storage.backend === "s3") {
    const s3 = new S3Storage(
      config.storage.s3!.endpoint,
      config.storage.s3!.accessKey,
      config.storage.s3!.secretKey,
      config.storage.s3!.bucket,
      config.storage.s3,
    );
    s3.publicURL = config.storage.s3!.publicURL;
    return s3;
  } else throw new Error("Unknown cache backend " + config.storage.backend);
}

const storage: IBlobStorage = await createStorage();
await storage.setup();

const log = logger.extend("storage");

export async function searchStorage(search: BlobSearch): Promise<StoragePointer | undefined> {
  const blob = await blobDB.getBlob(search.hash);
  if (blob && (await storage.hasBlob(search.hash))) {
    const type = blob.type || (await storage.getBlobType(search.hash));
    const size = blob.size || (await storage.getBlobSize(search.hash));
    log("Found", search.hash);
    return { type: "storage", hash: search.hash, mimeType: type, size };
  }
}

export function getStorageRedirect(pointer: StoragePointer) {
  const publicURL = config.storage.s3?.publicURL;
  if (storage instanceof S3Storage && publicURL) {
    const object = storage.objects.find((obj) => obj.name.startsWith(pointer.hash));
    if (object) return publicURL + object.name;
  }
}

export async function readStoragePointer(pointer: StoragePointer) {
  return await storage.readBlob(pointer.hash);
}

export async function pruneStorage() {
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
    if (n > 0) log("Checked", n, "blobs for rule #" + config.storage.rules.indexOf(rule));
  }
}

export default storage;
