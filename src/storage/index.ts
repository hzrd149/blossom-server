import { mkdirp } from "mkdirp";
import { config } from "../config.js";
import { LocalStorage, S3Storage, IBlobStorage } from "blossom-server-sdk/storage";

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
    );
    s3.publicURL = config.storage.s3!.publicURL;
    return s3;
  } else throw new Error("Unknown cache backend " + config.storage.backend);
}

const storage: IBlobStorage = await createStorage();
await storage.setup();

export default storage;
