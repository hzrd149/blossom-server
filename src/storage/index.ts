import { config } from "../config.js";
import { BlobStorage } from "./interface.js";
import LocalStorage from "./local.js";
import S3Storage from "./s3.js";

function createStorage() {
  if (config.cache.backend === "local") {
    return new LocalStorage(config.cache.local!.dir);
  } else if (config.cache.backend === "s3") {
    const s3 = new S3Storage(
      config.cache.s3!.endpoint,
      config.cache.s3!.accessKey,
      config.cache.s3!.secretKey,
      config.cache.s3!.bucket,
    );
    s3.publicURL = config.cache.s3!.publicURL;
    return s3;
  } else throw new Error("Unknown cache backend " + config.cache.backend);
}

const storage: BlobStorage = createStorage();
await storage.setup();

export default storage;
