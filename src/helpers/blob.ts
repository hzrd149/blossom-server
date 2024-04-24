import { BlobMetadata } from "blossom-server-sdk";
import mime from "mime";
import { config } from "../config.js";

export function getBlobURL(blob: Pick<BlobMetadata, "sha256" | "type">, host?: string) {
  const ext = blob.type && mime.getExtension(blob.type);
  const domain = config.publicDomain || host;
  if (!domain) throw new Error("Cant find public hostname. set publicDomain");
  return new URL(blob.sha256 + (ext ? "." + ext : ""), domain).toString();
}
