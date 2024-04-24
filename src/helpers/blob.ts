import { BlobMetadata } from "blossom-server-sdk";
import mime from "mime";
import { config } from "../config.js";

export function getBlobURL(blob: Pick<BlobMetadata, "sha256" | "type">) {
  const ext = blob.type && mime.getExtension(blob.type);
  return new URL(blob.sha256 + (ext ? "." + ext : ""), config.publicDomain).toString();
}
