import crypto from "node:crypto";
import fs from "node:fs";

export function getFileHash(path: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(path);

    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
