import { mkdirp } from "mkdirp";
import { config } from "../config.js";
import { BlobMetadata } from "blossom-server-sdk";
import { LocalStorage, S3Storage, IBlobStorage } from "blossom-server-sdk/storage";
import dayjs from "dayjs";

import { BlobSearch, StoragePointer } from "../types.js";
import db, { blobDB } from "../db/db.js";
import logger from "../logger.js";
import { getExpirationTime } from "../rules/index.js";
import { forgetBlobAccessed, updateBlobAccess } from "../db/methods.js";
import { readUpload, removeUpload, UploadDetails } from "./upload.js";
import { mapParams } from "../admin-api/helpers.js";

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

const log = logger.extend("storage");

const storage: IBlobStorage = await createStorage();

log("Setting up storage");
await storage.setup();

export async function searchStorage(search: BlobSearch): Promise<StoragePointer | undefined> {
  const blob = await blobDB.getBlob(search.hash);
  if (blob && (await storage.hasBlob(search.hash))) {
    const type = blob.type || (await storage.getBlobType(search.hash));
    const size = blob.size || (await storage.getBlobSize(search.hash));
    log("Found", search.hash);
    return { kind: "storage", hash: search.hash, type: type, size };
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

export async function addFromUpload(upload: UploadDetails, type?: string) {
  type = type || upload.type;

  let blob: BlobMetadata;

  if (!blobDB.hasBlob(upload.sha256)) {
    log("Saving", upload.sha256, type, upload.size);
    await storage.writeBlob(upload.sha256, readUpload(upload), type);
    await removeUpload(upload);

    const now = dayjs().unix();
    blob = blobDB.addBlob({ sha256: upload.sha256, size: upload.size, type, uploaded: now });
    updateBlobAccess(upload.sha256, dayjs().unix());
  } else {
    blob = blobDB.getBlob(upload.sha256);
    await removeUpload(upload);
  }

  return blob;
}

export async function pruneStorage() {
  const now = dayjs().unix();
  const checked = new Set<string>();

  /** Remove all blobs that no longer fall under any rules */
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

  // remove blobs with no owners
  if (config.storage.removeWhenNoOwners) {
    const blobs = db
      .prepare<[], { sha256: string }>(
        `
      SELECT blobs.sha256
      FROM blobs
        LEFT JOIN owners ON owners.blob = sha256
      WHERE owners.blob is NULL
    `,
      )
      .all();

    if (blobs.length > 0) {
      log(`Removing ${blobs.length} because they have no owners`);
      db.prepare<string[]>(`DELETE FROM blobs WHERE sha256 IN ${mapParams(blobs)}`).run(...blobs.map((b) => b.sha256));
    }
  }
}

export default storage;
