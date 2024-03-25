import { config } from "../config.js";
import { LocalStorage, S3Storage, IBlobStorage } from "blossom-server-sdk/storage";

function createStorage() {
  if (config.storage.backend === "local") {
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

const storage: IBlobStorage = createStorage();
await storage.setup();

export default storage;
